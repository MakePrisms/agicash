import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  sparkMnemonicQueryOptions,
  sparkWalletQueryOptions,
} from '~/features/shared/spark';
import { connectBreezWallet } from '~/lib/breez-spark/init';
import { getSparkIdentityPublicKeyFromMnemonic } from '~/lib/spark';

import {
  type EventLogEntry,
  createEventListener,
} from '~/lib/breez-spark/events';

type TestResult = {
  sparkKey: string;
  breezKey: string;
  match: boolean;
};

type BreezSdkInstance = Awaited<ReturnType<typeof connectBreezWallet>>;

type BalanceState = {
  breezSats: number | null;
  sparkSats: bigint | null;
  lastUpdated: Date | null;
};

export default function TestBreezKeyDerivation() {
  const queryClient = useQueryClient();
  const { data: mnemonic } = useSuspenseQuery(sparkMnemonicQueryOptions());
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Shared Breez SDK instance — ref mirrors state so cleanup always sees latest
  const [breezSdk, _setBreezSdk] = useState<BreezSdkInstance | null>(null);
  const breezSdkRef = useRef<BreezSdkInstance | null>(null);
  const setBreezSdk = useCallback((sdk: BreezSdkInstance | null) => {
    breezSdkRef.current = sdk;
    _setBreezSdk(sdk);
  }, []);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const listenerIdRef = useRef<string | null>(null);

  // Balance state
  const [balanceState, setBalanceState] = useState<BalanceState>({
    breezSats: null,
    sparkSats: null,
    lastUpdated: null,
  });
  const [balanceLoading, setBalanceLoading] = useState(false);

  // Event log
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);

  // Invoice state
  const [invoiceAmount, setInvoiceAmount] = useState(100);
  const [invoiceResult, setInvoiceResult] = useState<{
    paymentRequest: string;
    fee: string;
  } | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  // Connect Breez SDK
  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const sdk = await connectBreezWallet(mnemonic);

      // Register event listener
      const listener = createEventListener((entry) => {
        setEventLog((prev) => [entry, ...prev].slice(0, 100));
      });
      const id = await sdk.addEventListener(listener);
      listenerIdRef.current = id;

      setBreezSdk(sdk);
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, [mnemonic, setBreezSdk]);

  // Fetch balances
  const fetchBalances = useCallback(async () => {
    if (!breezSdk) return;
    setBalanceLoading(true);
    try {
      const [breezInfo, sparkWallet] = await Promise.all([
        breezSdk.getInfo({ ensureSynced: true }),
        queryClient.fetchQuery(
          sparkWalletQueryOptions({ network: 'MAINNET', mnemonic }),
        ),
      ]);

      const { satsBalance } = await sparkWallet.getBalance();

      setBalanceState({
        breezSats: breezInfo.balanceSats,
        sparkSats: satsBalance.available,
        lastUpdated: new Date(),
      });
    } catch (e) {
      console.error('Balance fetch failed:', e);
    } finally {
      setBalanceLoading(false);
    }
  }, [breezSdk, mnemonic, queryClient]);

  // Auto-poll balances every 3 seconds
  useEffect(() => {
    if (!breezSdk) return;

    // Initial fetch
    fetchBalances();

    const interval = setInterval(fetchBalances, 3000);
    return () => clearInterval(interval);
  }, [breezSdk, fetchBalances]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const sdk = breezSdkRef.current;
      const listenerId = listenerIdRef.current;
      if (sdk) {
        if (listenerId) {
          sdk.removeEventListener(listenerId).catch(console.error);
        }
        sdk.disconnect().catch(console.error);
      }
    };
  }, []);

  // Create invoice
  const handleCreateInvoice = useCallback(async () => {
    if (!breezSdk) return;
    setInvoiceLoading(true);
    setInvoiceError(null);
    setInvoiceResult(null);
    try {
      const response = await breezSdk.receivePayment({
        paymentMethod: {
          type: 'bolt11Invoice',
          description: 'Breez test',
          amountSats: invoiceAmount,
        },
      });
      setInvoiceResult({
        paymentRequest: response.paymentRequest,
        fee: String(response.fee),
      });
    } catch (e) {
      setInvoiceError(e instanceof Error ? e.message : String(e));
    } finally {
      setInvoiceLoading(false);
    }
  }, [breezSdk, invoiceAmount]);

  const runTest = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Derive identity public key using current Spark SDK
      const sparkKey = await getSparkIdentityPublicKeyFromMnemonic(
        mnemonic,
        'MAINNET',
      );

      // Initialize Breez wallet and get identity public key
      const breezSdkInstance = await connectBreezWallet(mnemonic);
      try {
        const info = await breezSdkInstance.getInfo({ ensureSynced: false });
        const breezKey = info.identityPubkey;

        setResult({
          sparkKey,
          breezKey,
          match: sparkKey === breezKey,
        });
      } finally {
        await breezSdkInstance.disconnect();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mnemonic]);

  return (
    <div
      className="mx-auto max-w-xl space-y-8 overflow-y-auto p-6"
      style={{ maxHeight: '100dvh' }}
    >
      {/* Section: C1 Key Derivation */}
      <section className="space-y-4">
        <h1 className="font-bold text-2xl">C1: Key Derivation Compatibility</h1>
        <p className="text-muted-foreground text-sm">
          Derives the identity public key from the same mnemonic using both the
          current Spark SDK and the Breez SDK, then compares them. If they do
          not match, the migration is a dealbreaker.
        </p>

        <button
          type="button"
          onClick={runTest}
          disabled={loading}
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Running...' : 'Run Key Derivation Test'}
        </button>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 p-4 text-red-800 text-sm dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            <p className="font-medium">Error</p>
            <p className="mt-1 break-all font-mono text-xs">{error}</p>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div
              className={`rounded-md border p-4 text-center font-bold text-lg ${
                result.match
                  ? 'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
                  : 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
              }`}
            >
              {result.match ? 'MATCH' : 'MISMATCH'}
            </div>

            <div className="space-y-3">
              <div>
                <p className="font-medium text-muted-foreground text-xs uppercase">
                  Spark SDK Identity Public Key
                </p>
                <p className="mt-1 break-all rounded bg-gray-100 p-2 font-mono text-xs dark:bg-gray-900">
                  {result.sparkKey}
                </p>
              </div>
              <div>
                <p className="font-medium text-muted-foreground text-xs uppercase">
                  Breez SDK Identity Public Key
                </p>
                <p className="mt-1 break-all rounded bg-gray-100 p-2 font-mono text-xs dark:bg-gray-900">
                  {result.breezKey}
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      <hr className="border-border" />

      {/* Section: C2 Balance Comparison */}
      <section className="space-y-4">
        <h2 className="font-bold text-xl">C2: Balance Comparison</h2>
        <p className="text-muted-foreground text-sm">
          Connects the Breez SDK and polls both SDKs for balance every 3
          seconds. Compare the reported balances side by side.
        </p>

        {!breezSdk ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting}
              className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {connecting ? 'Connecting...' : 'Connect Breez SDK'}
            </button>
            {connectError && (
              <div className="rounded-md border border-red-300 bg-red-50 p-4 text-red-800 text-sm dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                <p className="font-medium">Connection Error</p>
                <p className="mt-1 break-all font-mono text-xs">
                  {connectError}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              <span className="text-green-700 text-sm dark:text-green-400">
                Breez SDK connected
              </span>
            </div>

            <button
              type="button"
              onClick={fetchBalances}
              disabled={balanceLoading}
              className="rounded-md bg-secondary px-3 py-1.5 font-medium text-secondary-foreground text-sm hover:bg-secondary/80 disabled:opacity-50"
            >
              {balanceLoading ? 'Refreshing...' : 'Refresh Balances'}
            </button>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border p-3">
                <p className="font-medium text-muted-foreground text-xs uppercase">
                  Breez SDK Balance
                </p>
                <p className="mt-1 font-mono text-lg">
                  {balanceState.breezSats !== null
                    ? `${balanceState.breezSats} sats`
                    : '--'}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="font-medium text-muted-foreground text-xs uppercase">
                  Current SDK Balance
                </p>
                <p className="mt-1 font-mono text-lg">
                  {balanceState.sparkSats !== null
                    ? `${String(balanceState.sparkSats)} sats`
                    : '--'}
                </p>
              </div>
            </div>

            {balanceState.breezSats !== null &&
              balanceState.sparkSats !== null && (
                <div
                  className={`rounded-md border p-2 text-center text-sm ${
                    balanceState.breezSats === Number(balanceState.sparkSats)
                      ? 'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
                      : 'border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200'
                  }`}
                >
                  {balanceState.breezSats === Number(balanceState.sparkSats)
                    ? 'Balances match'
                    : `Mismatch: Breez=${balanceState.breezSats}, Spark=${String(balanceState.sparkSats)}`}
                </div>
              )}

            {balanceState.lastUpdated && (
              <p className="text-muted-foreground text-xs">
                Last updated: {balanceState.lastUpdated.toLocaleTimeString()}
              </p>
            )}
          </div>
        )}
      </section>

      <hr className="border-border" />

      {/* Section: C3 Event Log */}
      <section className="space-y-4">
        <h2 className="font-bold text-xl">C3: Event Log</h2>
        <p className="text-muted-foreground text-sm">
          Listens to Breez SDK events after connection. Events appear here in
          real time, newest first.
        </p>

        {!breezSdk ? (
          <p className="text-muted-foreground text-sm italic">
            Connect Breez SDK above to start receiving events.
          </p>
        ) : eventLog.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            No events received yet. Waiting...
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-md border">
            {eventLog.map((entry, i) => (
              <div
                key={`${entry.timestamp.getTime()}-${i}`}
                className="flex items-start gap-2 border-b px-3 py-2 last:border-b-0"
              >
                <span
                  className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${getEventColor(entry.eventType)}`}
                />
                <div className="min-w-0 flex-1">
                  <span className="font-medium font-mono text-xs">
                    {entry.eventType}
                  </span>
                  <span className="ml-2 text-muted-foreground text-xs">
                    {entry.timestamp.toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-muted-foreground text-xs">
          {eventLog.length} event{eventLog.length !== 1 ? 's' : ''} logged (max
          100)
        </p>
      </section>

      <hr className="border-border" />

      {/* Section: Create Invoice (Receive Test) */}
      <section className="space-y-4">
        <h2 className="font-bold text-xl">Create Invoice (Receive Test)</h2>
        <p className="text-muted-foreground text-sm">
          Creates a bolt11 invoice using the Breez SDK. Pay this from another
          wallet to test receiving.
        </p>

        {!breezSdk ? (
          <p className="text-muted-foreground text-sm italic">
            Connect Breez SDK above to create invoices.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <label
                htmlFor="invoice-amount"
                className="whitespace-nowrap text-sm"
              >
                Amount (sats):
              </label>
              <input
                id="invoice-amount"
                type="number"
                min={1}
                value={invoiceAmount}
                onChange={(e) =>
                  setInvoiceAmount(Number.parseInt(e.target.value, 10) || 0)
                }
                className="w-24 rounded-md border px-2 py-1 font-mono text-sm"
              />
            </div>

            <button
              type="button"
              onClick={handleCreateInvoice}
              disabled={invoiceLoading || invoiceAmount <= 0}
              className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {invoiceLoading ? 'Creating...' : 'Create Breez Invoice'}
            </button>

            {invoiceError && (
              <div className="rounded-md border border-red-300 bg-red-50 p-4 text-red-800 text-sm dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                <p className="font-medium">Invoice Error</p>
                <p className="mt-1 break-all font-mono text-xs">
                  {invoiceError}
                </p>
              </div>
            )}

            {invoiceResult && (
              <div className="space-y-2">
                <div>
                  <p className="font-medium text-muted-foreground text-xs uppercase">
                    Payment Request
                  </p>
                  <p className="mt-1 max-h-32 overflow-y-auto break-all rounded bg-gray-100 p-2 font-mono text-xs dark:bg-gray-900">
                    {invoiceResult.paymentRequest}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground text-xs uppercase">
                    Fee
                  </p>
                  <p className="mt-1 font-mono text-sm">
                    {invoiceResult.fee} sats
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function getEventColor(eventType: string): string {
  switch (eventType) {
    case 'paymentSucceeded':
    case 'claimedDeposits':
      return 'bg-green-500';
    case 'paymentPending':
    case 'unclaimedDeposits':
      return 'bg-yellow-500';
    case 'paymentFailed':
      return 'bg-red-500';
    default:
      return 'bg-gray-400';
  }
}
