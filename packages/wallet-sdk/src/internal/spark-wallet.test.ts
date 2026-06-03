import { describe, expect, test } from 'bun:test';
import {
  type BreezRuntime,
  SparkWalletCache,
  createSparkWalletStub,
  getInitializedSparkWallet,
} from './spark-wallet';

const MNEMONIC = 'test test test test test test test test test test test junk';

/**
 * A mock Breez runtime: `connect` returns a fake wallet whose `getInfo` yields a fixed
 * balance, and counts connections. The native WASM module is NEVER imported — the resolver
 * always injects this in tests.
 */
function makeRuntime(
  opts: { balanceSats?: number; failConnect?: boolean } = {},
): { runtime: BreezRuntime; connects: () => number } {
  let connects = 0;
  const runtime = {
    defaultConfig: (_network: 'mainnet' | 'regtest') =>
      ({ network: 'regtest' }) as never,
    initLogging: async () => {
      /* no-op logger */
    },
    connect: async (_req: never) => {
      connects++;
      if (opts.failConnect) {
        throw new Error('connect failed');
      }
      return {
        getInfo: async (_r: unknown) => ({
          balanceSats: opts.balanceSats ?? 1234,
        }),
      } as never;
    },
  } as unknown as BreezRuntime;
  return { runtime, connects: () => connects };
}

describe('createSparkWalletStub', () => {
  test('throws the given reason on any method call', () => {
    const stub = createSparkWalletStub('offline') as unknown as {
      getInfo: () => unknown;
    };
    expect(() => stub.getInfo()).toThrow('offline');
  });
});

describe('getInitializedSparkWallet', () => {
  test('connects, reads balance, reports online', async () => {
    const { runtime } = makeRuntime({ balanceSats: 5000 });
    const cache = new SparkWalletCache();

    const { balance, isOnline } = await getInitializedSparkWallet({
      cache,
      mnemonic: MNEMONIC,
      network: 'REGTEST',
      storageDir: '/tmp/spark-test',
      apiKey: 'k',
      runtime,
    });

    expect(isOnline).toBe(true);
    expect(balance?.toNumber('sat')).toBe(5000);
  });

  test('memoises the connection per (mnemonic, network)', async () => {
    const { runtime, connects } = makeRuntime();
    const cache = new SparkWalletCache();
    const params = {
      cache,
      mnemonic: MNEMONIC,
      network: 'REGTEST' as const,
      storageDir: '/tmp/spark-test',
      apiKey: 'k',
      runtime,
    };

    await getInitializedSparkWallet(params);
    await getInitializedSparkWallet(params);

    expect(connects()).toBe(1);
  });

  test('on connect failure: returns a throwing stub, offline, null balance', async () => {
    const { runtime } = makeRuntime({ failConnect: true });
    const cache = new SparkWalletCache();

    const { wallet, balance, isOnline } = await getInitializedSparkWallet({
      cache,
      mnemonic: MNEMONIC,
      network: 'MAINNET',
      storageDir: '/tmp/spark-test',
      apiKey: 'k',
      runtime,
    });

    expect(isOnline).toBe(false);
    expect(balance).toBeNull();
    expect(() =>
      (wallet as unknown as { getInfo: () => unknown }).getInfo(),
    ).toThrow();
  });

  test('a failed connect is not memoised (next call retries)', async () => {
    let mode: 'fail' | 'ok' = 'fail';
    let connects = 0;
    const runtime = {
      defaultConfig: () => ({}) as never,
      initLogging: async () => {
        /* no-op logger */
      },
      connect: async () => {
        connects++;
        if (mode === 'fail') {
          throw new Error('down');
        }
        return { getInfo: async () => ({ balanceSats: 1 }) } as never;
      },
    } as unknown as BreezRuntime;
    const cache = new SparkWalletCache();
    const params = {
      cache,
      mnemonic: MNEMONIC,
      network: 'REGTEST' as const,
      storageDir: '/tmp/spark-test',
      apiKey: 'k',
      runtime,
    };

    const first = await getInitializedSparkWallet(params);
    expect(first.isOnline).toBe(false);
    mode = 'ok';
    const second = await getInitializedSparkWallet(params);
    expect(second.isOnline).toBe(true);
    expect(connects).toBe(2);
  });
});
