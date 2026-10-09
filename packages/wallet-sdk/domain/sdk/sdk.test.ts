import { describe, expect, it } from 'bun:test';
import type { AuthKeyValueStore, SdkConfig } from '.';
import { NotImplementedError } from '../../lib/error';
import { nullLogger } from '../../lib/logger';
import { WebAssemblyUnavailableError } from '../../lib/spark/errors';
import { AgicashSdk } from './sdk';

const createMemoryStore = (): AuthKeyValueStore => {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
};

const createConfig = (): SdkConfig => ({
  db: { url: 'http://localhost:54321', anonKey: 'anon-key' },
  auth: {
    apiUrl: 'http://localhost:3100',
    clientId: '00000000-0000-0000-0000-000000000000',
    storage: { persistent: createMemoryStore(), session: createMemoryStore() },
  },
  spark: { breezApiKey: 'key', network: 'MAINNET' },
  lightningAddressDomain: 'localhost',
  logger: nullLogger,
});

describe('AgicashSdk.create', () => {
  it('refuses a second instance until the first is disposed', async () => {
    const sdk = AgicashSdk.create(createConfig());
    try {
      expect(() => AgicashSdk.create(createConfig())).toThrow(
        /dispose\(\) the previous instance/,
      );
    } finally {
      await sdk.dispose();
    }

    const next = AgicashSdk.create(createConfig());
    await next.dispose();
  });
});

describe('AgicashSdk.init', () => {
  it('rejects with WebAssemblyUnavailableError when the runtime lacks WebAssembly, with session restore still invoked', async () => {
    const saved = globalThis.WebAssembly;
    (globalThis as { WebAssembly?: unknown }).WebAssembly = undefined;
    let storeReads = 0;
    const countReads = (store: AuthKeyValueStore): AuthKeyValueStore => ({
      ...store,
      getItem: (key) => {
        storeReads += 1;
        return store.getItem(key);
      },
    });
    const config = createConfig();
    config.auth.storage = {
      persistent: countReads(config.auth.storage.persistent),
      session: countReads(config.auth.storage.session),
    };
    try {
      const sdk = AgicashSdk.create(config);
      storeReads = 0;
      await expect(sdk.init()).rejects.toBeInstanceOf(
        WebAssemblyUnavailableError,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(storeReads).toBeGreaterThan(0);
      await sdk.dispose();
    } finally {
      (globalThis as { WebAssembly?: unknown }).WebAssembly = saved;
    }
  });
});

describe('AgicashSdk namespaces', () => {
  it('wires send and transfer; resolveDestination throws NotImplementedError', async () => {
    const sdk = AgicashSdk.create(createConfig());
    try {
      expect(() => sdk.send).not.toThrow();
      expect(sdk.send).toBe(sdk.send);
      expect(typeof sdk.send.cashu.getLightningQuote).toBe('function');
      expect(typeof sdk.send.cashu.createQuote).toBe('function');
      expect(typeof sdk.send.cashu.getSwapQuote).toBe('function');
      expect(typeof sdk.send.cashu.createSwap).toBe('function');
      expect(typeof sdk.send.spark.getLightningQuote).toBe('function');
      expect(typeof sdk.send.spark.createQuote).toBe('function');
      expect(() => sdk.send.resolveDestination).toThrow(NotImplementedError);
      expect(sdk.transfer).toBe(sdk.transfer);
      expect(typeof sdk.transfer.getQuote).toBe('function');
      expect(typeof sdk.transfer.initiate).toBe('function');
    } finally {
      await sdk.dispose();
    }
  });
});
