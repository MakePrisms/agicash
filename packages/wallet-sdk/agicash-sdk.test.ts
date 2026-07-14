import { describe, expect, it } from 'bun:test';
import { AgicashSdk, getInternalSessionKeys } from './agicash-sdk';
import { nullLogger } from './lib/logger';
import type { AuthKeyValueStore, SdkConfig } from './sdk';

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

describe('getInternalSessionKeys', () => {
  it('throws when no instance is live', () => {
    expect(() => getInternalSessionKeys()).toThrow(
      'No live AgicashSdk instance',
    );
  });

  it('returns the live instance session keys and clears them on dispose', async () => {
    const sdk = AgicashSdk.create(createConfig());

    const keys = getInternalSessionKeys();
    // Same reference every call: the accessor hands back the instance's single
    // session-keys object, not a fresh derivation per call.
    expect(getInternalSessionKeys()).toBe(keys);
    expect(typeof keys.getEncryption).toBe('function');

    await sdk.dispose();

    expect(() => getInternalSessionKeys()).toThrow(
      'No live AgicashSdk instance',
    );
  });
});
