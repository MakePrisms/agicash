import { describe, expect, it } from 'bun:test';
import type { AuthKeyValueStore, SdkConfig } from '.';
import { nullLogger } from '../../lib/logger';
import { AgicashSdk, getInternalAccountRepository } from './sdk';

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

describe('getInternalAccountRepository', () => {
  it('throws when no instance is live', () => {
    expect(() => getInternalAccountRepository()).toThrow(
      'No live AgicashSdk instance',
    );
  });

  it('resolves through the live instance and clears on dispose', async () => {
    const sdk = AgicashSdk.create(createConfig());

    // While live the guard passes and the accessor returns the repository
    // promise. Its key derivation is exercised in the accounts-api tests; here
    // we only assert the bridge is wired, so the derivation is left to settle.
    const pending = getInternalAccountRepository();
    expect(pending).toBeInstanceOf(Promise);
    pending.catch(() => {
      // The derivation reaches Open Secret, which this env cannot; the bridge
      // wiring is all we assert here, so let the rejection settle unobserved.
    });

    await sdk.dispose();

    expect(() => getInternalAccountRepository()).toThrow(
      'No live AgicashSdk instance',
    );
  });
});
