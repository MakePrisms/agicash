import { useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { sparkMnemonicQueryOptions } from '~/features/shared/spark';
import { connectBreezWallet } from '~/lib/breez-spark/init';

import {
  type EventLogEntry,
  createEventListener,
} from '~/lib/breez-spark/events';

type BreezSdkInstance = Awaited<ReturnType<typeof connectBreezWallet>>;

type BalanceState = {
  breezSats: number | null;
  updatedAt: Date | null;
};

export default function TestBreezOnly() {
  const { data: mnemonic } = useSuspenseQuery(sparkMnemonicQueryOptions());

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
    updatedAt: null,
  });
  const prevBreezSats = useRef<number | null>(null);
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

      // Log the default config so we can see syncIntervalSecs
      const { defaultConfig } = await import('@breeztech/breez-sdk-spark');
      const config = defaultConfig('mainnet');
      console.log('[Breez] Default config:', {
        syncIntervalSecs: config.syncIntervalSecs,
        realTimeSyncServerUrl: config.realTimeSyncServerUrl,
        preferSparkOverLightning: config.preferSparkOverLightning,
      });

      // Register event listener — fetch balance on payment/sync events
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
              breezSats: info.balanceSats,
              updatedAt:
                info.balanceSats !== prevBreezSats.current
                  ? now
                  : prev.updatedAt,
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

  // Fetch balance — sync first so getInfo returns fresh state
  const fetchBalance = useCallback(async () => {
    if (!breezSdk) return;
    setBalanceLoading(true);
    try {
      const [breezInfo, unclaimed] = await Promise.all([
        breezSdk.getInfo({}),
        breezSdk.listUnclaimedDeposits({}),
      ]);

      if (unclaimed.deposits.length > 0) {
        console.log(
          `[Breez] ${unclaimed.deposits.length} unclaimed deposits:`,
          unclaimed.deposits,
        );
      }

      const now = new Date();
      setBalanceState((prev) => ({
        breezSats: breezInfo.balanceSats,
        updatedAt:
          breezInfo.balanceSats !== prevBreezSats.current
            ? now
            : prev.updatedAt,
      }));
      prevBreezSats.current = breezInfo.balanceSats;
    } catch (e) {
      console.error('Balance fetch failed:', e);
    } finally {
      setBalanceLoading(false);
    }
  }, [breezSdk]);

  // // Auto-poll balance every 3 seconds
  // useEffect(() => {
  //   if (!breezSdk) return;
  //   fetchBalance();
  //   const interval = setInterval(fetchBalance, 3000);
  //   return () => clearInterval(interval);
  // }, [breezSdk, fetchBalance]);

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

  return (
    <div
      className="mx-auto max-w-xl space-y-8 overflow-y-auto p-6"
      style={{ maxHeight: '100dvh' }}
    >
      {/* Balance */}
      <section className="space-y-4">
        <h1 className="font-bold text-2xl">Breez SDK — Balance Test</h1>

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
              onClick={fetchBalance}
              disabled={balanceLoading}
              className="rounded-md bg-secondary px-3 py-1.5 font-medium text-secondary-foreground text-sm hover:bg-secondary/80 disabled:opacity-50"
            >
              {balanceLoading ? 'Refreshing...' : 'Refresh Balance'}
            </button>

            <div className="rounded-md border p-4">
              <p className="font-medium text-muted-foreground text-xs uppercase">
                Breez SDK Balance
              </p>
              <p className="mt-1 font-mono text-2xl">
                {balanceState.breezSats !== null
                  ? `${balanceState.breezSats} sats`
                  : '--'}
              </p>
              {balanceState.updatedAt && (
                <p className="mt-1 text-muted-foreground text-xs">
                  Last changed: {balanceState.updatedAt.toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      <hr className="border-border" />

      {/* Event Log */}
      <section className="space-y-4">
        <h2 className="font-bold text-xl">Event Log</h2>

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

      {/* Create Invoice */}
      <section className="space-y-4">
        <h2 className="font-bold text-xl">Create Invoice (Receive Test)</h2>

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
