import { describe, expect, it } from 'bun:test';
import { AgicashSdk } from './agicash-sdk';
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
