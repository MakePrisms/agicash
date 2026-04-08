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

  // Init performance state
  const wasmInitMs = (globalThis as Record<string, unknown>)
    .__BREEZ_WASM_INIT_MS__ as number | undefined;
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

  // Measure init time (warm — reconnect after disconnect)
  const handleMeasureInit = useCallback(async () => {
    setInitMeasuring(true);
    setInitError(null);
    try {
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
      const prepared = await breezSdk.prepareSendPayment({
        paymentRequest:
          'lnbc1631400n1p5avsj6pp5gkhgj5v9us07dhgdc2lhgqqca6gpy3sjxathr36ear2t2m9ujk8qdqqcqzzsxqrrs0fppqstcjsap8rl6qya4y087rqezf7xelkw2ssp53kar26yu4n4tu0chqguhjdtzv4rllvv6y8ydt8gzg8ecgug23aes9qxpqysgqjhyltg7c2jsutkkdrep2kgvm2czhdk0j4tedphv70n68ee93vu69vxnrhv06t6qs4swvam55p9nrrqke2ruspvgz7d5659lhsfkq8zsqkv8xcy',
      });
      // If prepare succeeds, try to actually send — this should fail on balance
      await breezSdk.sendPayment({ preparedPayment: prepared });
      addErrorEntry(
        'Send More Than Balance',
        new Error('No error — send succeeded unexpectedly'),
      );
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

  const handleSendToSelf = useCallback(async () => {
    if (!breezSdk) return;
    setErrorCatalogLoading('send-self');
    try {
      // Create an invoice from our own wallet, then try to pay it
      const invoice = await breezSdk.receivePayment({
        paymentMethod: {
          type: 'bolt11Invoice',
          description: 'Self-pay test',
          amountSats: 10,
        },
      });
      await breezSdk.prepareSendPayment({
        paymentRequest: invoice.paymentRequest,
      });
    } catch (e) {
      addErrorEntry('Send to Self', e);
    } finally {
      setErrorCatalogLoading(null);
    }
  }, [breezSdk, addErrorEntry]);

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

      <hr className="border-border" />

      {/* C6: Init Performance */}
      <section className="space-y-4">
        <h2 className="font-bold text-xl">C6: Init Performance</h2>
        <p className="text-muted-foreground text-sm">
          Measures Breez SDK initialization. WASM init runs on page load
          (entry.client.tsx). Connect + getInfo is the equivalent of
          getInitializedSparkWallet.
        </p>

        <div className="rounded-md border p-3">
          <p className="font-medium text-muted-foreground text-xs uppercase">
            WASM Module Init (page load)
          </p>
          <p className="mt-1 font-mono text-lg">
            {wasmInitMs !== undefined ? `${wasmInitMs} ms` : 'pending...'}
          </p>
        </div>

        {!breezSdk && initMeasurements.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            Connect Breez SDK above to see cold init time.
          </p>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleMeasureInit}
              disabled={initMeasuring}
              className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {initMeasuring ? 'Measuring...' : 'Measure Warm Init Time'}
            </button>

            {initError && (
              <div className="rounded-md border border-red-300 bg-red-50 p-4 text-red-800 text-sm dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                <p className="font-medium">Measurement Error</p>
                <p className="mt-1 break-all font-mono text-xs">{initError}</p>
              </div>
            )}

            {initMeasurements.length > 0 && (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 dark:bg-gray-900">
                      <th className="px-3 py-1.5 text-left font-medium text-xs">
                        Label
                      </th>
                      <th className="px-3 py-1.5 text-right font-medium text-xs">
                        Total (ms)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {initMeasurements.map((m, i) => (
                      <tr
                        key={`${m.label}-${m.ms}-${i}`}
                        className="border-b last:border-b-0"
                      >
                        <td className="px-3 py-1.5 text-xs">{m.label}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-xs">
                          {m.ms}
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

      <hr className="border-border" />

      {/* C7: Error Catalog */}
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
                onClick={handleSendToSelf}
                disabled={errorCatalogLoading !== null}
                className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {errorCatalogLoading === 'send-self'
                  ? 'Running...'
                  : 'Send to Self'}
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
