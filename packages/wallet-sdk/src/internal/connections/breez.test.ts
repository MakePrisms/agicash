import { describe, expect, it, mock } from 'bun:test';

// Capture call arguments for assertions below.
const wasmInitCalls: unknown[] = [];
const connectCalls: unknown[] = [];
const initLoggingCalls: unknown[] = [];

const mockConnect = mock(async (...args: unknown[]): Promise<object> => {
  connectCalls.push(args[0]);
  return {};
});

const mockInitLogging = mock(async (...args: unknown[]) => {
  initLoggingCalls.push(args[0]);
});

const mockInitWasm = mock(async () => {
  wasmInitCalls.push(null);
});

mock.module('@agicash/breez-sdk-spark', () => ({
  default: mockInitWasm,
  connect: mockConnect,
  initLogging: mockInitLogging,
  // defaultConfig returns a minimal base so the spread in connectBreez works.
  defaultConfig: (network: string) => ({
    network,
    syncIntervalSecs: 60,
    preferSparkOverLightning: false,
    useDefaultExternalInputParsers: true,
    privateEnabledDefault: false,
    optimizationConfig: { autoEnabled: false, multiplicity: 1 },
    maxConcurrentClaims: 4,
  }),
}));

const { initBreezWasm, tryInitLogging, connectBreez } = await import('./breez');

describe('initBreezWasm — single-flight WASM init', () => {
  it('calls the WASM init function exactly once across two concurrent calls', async () => {
    wasmInitCalls.length = 0;
    const [a, b] = await Promise.all([initBreezWasm(), initBreezWasm()]);
    // Both callers get the same resolved value (same promise).
    expect(a).toBe(b);
    // The underlying init was invoked exactly once.
    expect(wasmInitCalls).toHaveLength(1);
  });

  it('returns the same promise on a third sequential call', async () => {
    wasmInitCalls.length = 0;
    await initBreezWasm();
    // The promise was already resolved; invoking again should not re-call the init.
    expect(wasmInitCalls).toHaveLength(0);
  });
});

describe('tryInitLogging — single-global-subscriber guard (spec §8)', () => {
  it('calls initLogging exactly once across 3 calls (single-global-subscriber guard)', async () => {
    initLoggingCalls.length = 0;
    // The module-level loggingStatus is undefined before any call. Drive it
    // three times: the first sets status to 'initializing' and fires initLogging;
    // the second and third see a non-undefined status and return immediately.
    tryInitLogging(false);
    tryInitLogging(false);
    tryInitLogging(false);
    // Allow the async resolution to settle so the mock promise runs.
    await Promise.resolve();
    expect(initLoggingCalls).toHaveLength(1);
  });
});

describe('connectBreez — connect call shape', () => {
  it('calls connect with the correct seed, storageDir, and config fields', async () => {
    connectCalls.length = 0;
    const cfg = {
      apiKey: 'test-api-key',
      network: 'mainnet' as const,
      storageDir: '/tmp/spark-test',
    };
    const mnemonic =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    await connectBreez(cfg, mnemonic);

    expect(connectCalls).toHaveLength(1);
    const request = connectCalls[0] as {
      seed: { type: string; mnemonic: string };
      storageDir: string;
      config: {
        apiKey: string;
        network: string;
        privateEnabledDefault: boolean;
        optimizationConfig: { autoEnabled: boolean; multiplicity: number };
        lnurlDomain: undefined;
      };
    };

    expect(request.seed).toEqual({ type: 'mnemonic', mnemonic });
    expect(request.storageDir).toBe('/tmp/spark-test');
    expect(request.config.apiKey).toBe('test-api-key');
    expect(request.config.network).toBe('mainnet');
    expect(request.config.privateEnabledDefault).toBe(true);
    expect(request.config.optimizationConfig).toEqual({
      autoEnabled: true,
      multiplicity: 2,
    });
    expect(request.config.lnurlDomain).toBeUndefined();
  });
});
