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
  breezUpdatedAt: Date | null;
  sparkUpdatedAt: Date | null;
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
    breezUpdatedAt: null,
    sparkUpdatedAt: null,
    lastUpdated: null,
  });
  // Track previous balance to detect changes
  const prevBreezSats = useRef<number | null>(null);
  const prevSparkSats = useRef<bigint | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // Event log
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);

  // Breez-only mode: disconnect Spark SDK to test Breez in isolation
  const [breezOnlyMode, setBreezOnlyMode] = useState(false);
  const sparkDisconnectedRef = useRef(false);

  const toggleBreezOnlyMode = useCallback(async () => {
    if (!breezOnlyMode) {
      // Disconnect Spark wallet
      try {
        const sparkWallet = queryClient.getQueryData(
          sparkWalletQueryOptions({ network: 'MAINNET', mnemonic }).queryKey,
        ) as
          | Awaited<
              ReturnType<
                typeof import('@buildonspark/spark-sdk').SparkWallet.initialize
              >
            >
          | undefined;
        if (sparkWallet) {
          await sparkWallet.cleanupConnections();
          sparkDisconnectedRef.current = true;
          console.log('[Test] Spark SDK disconnected — Breez-only mode ON');
        }
      } catch (e) {
        console.error('Failed to disconnect Spark:', e);
      }
      setBreezOnlyMode(true);
    } else {
      // Reconnect Spark by invalidating the cached wallet (forces re-init)
      if (sparkDisconnectedRef.current) {
        queryClient.removeQueries({
          queryKey: sparkWalletQueryOptions({ network: 'MAINNET', mnemonic })
            .queryKey,
        });
        sparkDisconnectedRef.current = false;
        console.log(
          '[Test] Spark wallet cache cleared — will re-init on next fetch. Breez-only mode OFF',
        );
      }
      setBreezOnlyMode(false);
    }
  }, [breezOnlyMode, mnemonic, queryClient]);

  // Init performance state
  const [initMeasurements, setInitMeasurements] = useState<
    { ms: number; label: string }[]
  >([]);
  const [initMeasuring, setInitMeasuring] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // Error catalog state
  const [errorCatalog, setErrorCatalog] = useState<
    {
      scenario: string;
      constructorName: string;
      message: string;
      full: string;
    }[]
  >([]);
  const [errorCatalogLoading, setErrorCatalogLoading] = useState<string | null>(
    null,
  );

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
      const start = performance.now();
      const sdk = await connectBreezWallet(mnemonic);
      const connectMs = Math.round(performance.now() - start);

      const balanceStart = performance.now();
      const info = await sdk.getInfo({});
      const balanceMs = Math.round(performance.now() - balanceStart);
      const totalMs = Math.round(performance.now() - start);

      console.log(
        `[Breez] Init: connect=${connectMs}ms, getInfo=${balanceMs}ms, total=${totalMs}ms, balance=${info.balanceSats}`,
      );

      setInitMeasurements((prev) =>
        [
          {
            ms: totalMs,
            label: `Cold (connect=${connectMs}ms + getInfo=${balanceMs}ms)`,
          },
          ...prev,
        ].slice(0, 5),
      );

      // Log the default config so we can see syncIntervalSecs
      const { defaultConfig } = await import('@breeztech/breez-sdk-spark');
      const config = defaultConfig('mainnet');
      console.log('[Breez] Default config:', {
        syncIntervalSecs: config.syncIntervalSecs,
        realTimeSyncServerUrl: config.realTimeSyncServerUrl,
        preferSparkOverLightning: config.preferSparkOverLightning,
      });

      // Register event listener — also fetch balance on payment/sync events
      const listener = createEventListener((entry) => {
        setEventLog((prev) => [entry, ...prev].slice(0, 100));
        if (
          entry.eventType === 'paymentSucceeded' ||
          entry.eventType === 'paymentPending' ||
          entry.eventType === 'synced' ||
          entry.eventType === 'claimedDeposits'
        ) {
          breezSdkRef.current?.getInfo({}).then((info) => {
            console.log(
              `[Breez ${entry.eventType}] balanceSats: ${info.balanceSats} @ ${new Date().toISOString()}`,
            );
            const now = new Date();
            setBalanceState((prev) => ({
              ...prev,
              breezSats: info.balanceSats,
              breezUpdatedAt:
                info.balanceSats !== prevBreezSats.current
                  ? now
                  : prev.breezUpdatedAt,
              lastUpdated: now,
            }));
            prevBreezSats.current = info.balanceSats;
          });
        }
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

  // Fetch balances — sync Breez first so getInfo returns fresh state
  const fetchBalances = useCallback(async () => {
    if (!breezSdk) return;
    setBalanceLoading(true);
    try {
      await breezSdk.syncWallet({});
      const breezInfo = await breezSdk.getInfo({});

      let sparkBalance: bigint | null = null;
      if (!breezOnlyMode) {
        const sparkWallet = await queryClient.fetchQuery(
          sparkWalletQueryOptions({ network: 'MAINNET', mnemonic }),
        );
        const { satsBalance } = await sparkWallet.getBalance();
        sparkBalance = satsBalance.available;
      }

      const now = new Date();
      setBalanceState((prev) => ({
        breezSats: breezInfo.balanceSats,
        sparkSats: sparkBalance,
        breezUpdatedAt:
          breezInfo.balanceSats !== prevBreezSats.current
            ? now
            : prev.breezUpdatedAt,
        sparkUpdatedAt:
          sparkBalance !== null && sparkBalance !== prevSparkSats.current
            ? now
            : prev.sparkUpdatedAt,
        lastUpdated: now,
      }));
      prevBreezSats.current = breezInfo.balanceSats;
      if (sparkBalance !== null) prevSparkSats.current = sparkBalance;
    } catch (e) {
      console.error('Balance fetch failed:', e);
    } finally {
      setBalanceLoading(false);
    }
  }, [breezSdk, breezOnlyMode, mnemonic, queryClient]);

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

  // Measure init time
  const handleMeasureInit = useCallback(async () => {
    setInitMeasuring(true);
    setInitError(null);
    try {
      // Disconnect current instance if connected
      if (breezSdkRef.current) {
        if (listenerIdRef.current) {
          await breezSdkRef.current.removeEventListener(listenerIdRef.current);
          listenerIdRef.current = null;
        }
        await breezSdkRef.current.disconnect();
        setBreezSdk(null);
      }

      const start = performance.now();
      const sdk = await connectBreezWallet(mnemonic);
      const connectMs = Math.round(performance.now() - start);

      const balanceStart = performance.now();
      await sdk.getInfo({});
      const balanceMs = Math.round(performance.now() - balanceStart);
      const totalMs = Math.round(performance.now() - start);

      // Re-register event listener
      const listener = createEventListener((entry) => {
        setEventLog((prev) => [entry, ...prev].slice(0, 100));
        if (
          entry.eventType === 'paymentSucceeded' ||
          entry.eventType === 'paymentPending' ||
          entry.eventType === 'synced' ||
          entry.eventType === 'claimedDeposits'
        ) {
          breezSdkRef.current?.getInfo({}).then((info) => {
            const now = new Date();
            setBalanceState((prev) => ({
              ...prev,
              breezSats: info.balanceSats,
              breezUpdatedAt:
                info.balanceSats !== prevBreezSats.current
                  ? now
                  : prev.breezUpdatedAt,
              lastUpdated: now,
            }));
            prevBreezSats.current = info.balanceSats;
          });
        }
      });
      const id = await sdk.addEventListener(listener);
      listenerIdRef.current = id;

      setBreezSdk(sdk);

      const warmIndex = initMeasurements.filter((m) =>
        m.label.startsWith('Warm'),
      ).length;
      setInitMeasurements((prev) =>
        [
          {
            ms: totalMs,
            label: `Warm #${warmIndex + 1} (connect=${connectMs}ms + getInfo=${balanceMs}ms)`,
          },
          ...prev,
        ].slice(0, 5),
      );
    } catch (e) {
      setInitError(e instanceof Error ? e.message : String(e));
    } finally {
      setInitMeasuring(false);
    }
  }, [mnemonic, setBreezSdk, initMeasurements]);

  // Error catalog helpers
  const addErrorEntry = useCallback((scenario: string, e: unknown) => {
    setErrorCatalog((prev) => [
      {
        scenario,
        constructorName:
          e != null && typeof e === 'object' && 'constructor' in e
            ? (e as { constructor: { name: string } }).constructor.name
            : typeof e,
        message: e instanceof Error ? e.message : String(e),
        full: JSON.stringify(
          e,
          Object.getOwnPropertyNames(e instanceof Error ? e : {}),
        ),
      },
      ...prev,
    ]);
  }, []);

  const handleSendMoreThanBalance = useCallback(async () => {
    if (!breezSdk) return;
    setErrorCatalogLoading('send-more');
    try {
      await breezSdk.prepareSendPayment({
        paymentRequest:
          'lnbc9999999990n1pnnotfoundpp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqdq2f38xy6t5wvxqzjccqpjsp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9q',
        amount: BigInt(999_999_999),
      });
    } catch (e) {
      addErrorEntry('Send More Than Balance', e);
    } finally {
      setErrorCatalogLoading(null);
    }
  }, [breezSdk, addErrorEntry]);

  const handleSendInvalidInvoice = useCallback(async () => {
    if (!breezSdk) return;
    setErrorCatalogLoading('send-invalid');
    try {
      await breezSdk.prepareSendPayment({
        paymentRequest: 'invalid-invoice-string',
      });
    } catch (e) {
      addErrorEntry('Send to Invalid Invoice', e);
    } finally {
      setErrorCatalogLoading(null);
    }
  }, [breezSdk, addErrorEntry]);

  const handleReceiveZero = useCallback(async () => {
    if (!breezSdk) return;
    setErrorCatalogLoading('receive-zero');
    try {
      await breezSdk.receivePayment({
        paymentMethod: {
          type: 'bolt11Invoice',
          description: 'Zero amount test',
          amountSats: 0,
        },
      });
    } catch (e) {
      addErrorEntry('Receive Zero Amount', e);
    } finally {
      setErrorCatalogLoading(null);
    }
  }, [breezSdk, addErrorEntry]);

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

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={fetchBalances}
                disabled={balanceLoading}
                className="rounded-md bg-secondary px-3 py-1.5 font-medium text-secondary-foreground text-sm hover:bg-secondary/80 disabled:opacity-50"
              >
                {balanceLoading ? 'Refreshing...' : 'Refresh Balances'}
              </button>

              <button
                type="button"
                onClick={toggleBreezOnlyMode}
                className={`rounded-md px-3 py-1.5 font-medium text-sm ${
                  breezOnlyMode
                    ? 'bg-orange-500 text-white hover:bg-orange-600'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
              >
                {breezOnlyMode
                  ? 'Breez-only ON (Spark disconnected)'
                  : 'Enable Breez-only mode'}
              </button>
            </div>

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
                {balanceState.breezUpdatedAt && (
                  <p className="mt-0.5 text-muted-foreground text-xs">
                    changed: {balanceState.breezUpdatedAt.toLocaleTimeString()}
                  </p>
                )}
              </div>
              <div className="rounded-md border p-3">
                <p className="font-medium text-muted-foreground text-xs uppercase">
                  Spark SDK Balance
                </p>
                <p className="mt-1 font-mono text-lg">
                  {balanceState.sparkSats !== null
                    ? `${String(balanceState.sparkSats)} sats`
                    : '--'}
                </p>
                {balanceState.sparkUpdatedAt && (
                  <p className="mt-0.5 text-muted-foreground text-xs">
                    changed: {balanceState.sparkUpdatedAt.toLocaleTimeString()}
                  </p>
                )}
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

      <hr className="border-border" />

      {/* Section: C6 Init Performance */}
      <section className="space-y-4">
        <h2 className="font-bold text-xl">C6: Init Performance</h2>
        <p className="text-muted-foreground text-sm">
          Measures Breez SDK connection time. Disconnects the current instance,
          then reconnects and records elapsed milliseconds.
        </p>

        {!breezSdk && initMeasurements.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            Connect Breez SDK above to start measuring.
          </p>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleMeasureInit}
              disabled={initMeasuring}
              className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {initMeasuring ? 'Measuring...' : 'Measure Init Time'}
            </button>

            {initError && (
              <div className="rounded-md border border-red-300 bg-red-50 p-4 text-red-800 text-sm dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                <p className="font-medium">Measurement Error</p>
                <p className="mt-1 break-all font-mono text-xs">{initError}</p>
              </div>
            )}

            {initMeasurements.length > 0 && (
              <div className="space-y-2">
                <div className="rounded-md border border-green-300 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
                  <p className="font-medium text-muted-foreground text-xs uppercase">
                    Latest Measurement
                  </p>
                  <p className="mt-1 font-mono text-green-800 text-lg dark:text-green-200">
                    {initMeasurements[0].ms} ms{' '}
                    <span className="text-sm">
                      ({initMeasurements[0].label})
                    </span>
                  </p>
                </div>

                {initMeasurements.length > 1 && (
                  <div>
                    <p className="font-medium text-muted-foreground text-xs uppercase">
                      History (up to 5)
                    </p>
                    <div className="mt-1 overflow-x-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-gray-50 dark:bg-gray-900">
                            <th className="px-3 py-1.5 text-left font-medium text-xs">
                              #
                            </th>
                            <th className="px-3 py-1.5 text-left font-medium text-xs">
                              Label
                            </th>
                            <th className="px-3 py-1.5 text-right font-medium text-xs">
                              Time (ms)
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {initMeasurements.map((m, i) => (
                            <tr
                              key={`${m.label}-${m.ms}-${i}`}
                              className="border-b last:border-b-0"
                            >
                              <td className="px-3 py-1.5 font-mono text-xs">
                                {initMeasurements.length - i}
                              </td>
                              <td className="px-3 py-1.5 text-xs">{m.label}</td>
                              <td className="px-3 py-1.5 text-right font-mono text-xs">
                                {m.ms}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <hr className="border-border" />

      {/* Section: C7 Error Catalog */}
      <section className="space-y-4">
        <h2 className="font-bold text-xl">C7: Error Catalog</h2>
        <p className="text-muted-foreground text-sm">
          Deliberately triggers SDK errors to catalog error types, messages, and
          structure.
        </p>

        {!breezSdk ? (
          <p className="text-muted-foreground text-sm italic">
            Connect Breez SDK above to test error scenarios.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSendMoreThanBalance}
                disabled={errorCatalogLoading !== null}
                className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {errorCatalogLoading === 'send-more'
                  ? 'Running...'
                  : 'Send More Than Balance'}
              </button>
              <button
                type="button"
                onClick={handleSendInvalidInvoice}
                disabled={errorCatalogLoading !== null}
                className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {errorCatalogLoading === 'send-invalid'
                  ? 'Running...'
                  : 'Send to Invalid Invoice'}
              </button>
              <button
                type="button"
                onClick={handleReceiveZero}
                disabled={errorCatalogLoading !== null}
                className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {errorCatalogLoading === 'receive-zero'
                  ? 'Running...'
                  : 'Receive Zero Amount'}
              </button>
            </div>

            {errorCatalog.length > 0 && (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 dark:bg-gray-900">
                      <th className="px-3 py-1.5 text-left font-medium text-xs">
                        Scenario
                      </th>
                      <th className="px-3 py-1.5 text-left font-medium text-xs">
                        Constructor
                      </th>
                      <th className="px-3 py-1.5 text-left font-medium text-xs">
                        Message
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {errorCatalog.map((entry, i) => (
                      <tr
                        key={`${entry.scenario}-${i}`}
                        className="border-b last:border-b-0"
                      >
                        <td className="px-3 py-1.5 text-xs">
                          {entry.scenario}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs">
                          {entry.constructorName}
                        </td>
                        <td className="px-3 py-1.5 text-xs">
                          <p className="max-w-xs truncate">{entry.message}</p>
                          <details className="mt-1">
                            <summary className="cursor-pointer text-muted-foreground text-xs">
                              Full error
                            </summary>
                            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-gray-100 p-2 font-mono text-xs dark:bg-gray-900">
                              {entry.full}
                            </pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
