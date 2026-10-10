import { describe, expect, it, spyOn } from 'bun:test';
import { Money } from '@agicash/money';
import type { ServerSdkConfig, ServerSdkConstructor } from './server';
import { AgicashServerSdk } from './server-sdk';

const serverSdkConstructor: ServerSdkConstructor = AgicashServerSdk;
void serverSdkConstructor;

const FIXTURE_KEY =
  '1111111111111111111111111111111111111111111111111111111111111111';

const createConfig = (quoteEncryptionKey = FIXTURE_KEY): ServerSdkConfig => ({
  db: { url: 'http://127.0.0.1:54321', serviceRoleKey: 'service-role-test' },
  spark: {
    breezApiKey: 'k',
    network: 'MAINNET',
    mnemonic: 'mn',
    storageDir: '/tmp/test-spark',
  },
  quoteEncryptionKey,
});

describe('AgicashServerSdk.create', () => {
  it('is sync, exposes the lightningAddress facade, and refuses a second instance until disposed', async () => {
    const sdk = AgicashServerSdk.create(createConfig());
    try {
      expect(sdk.lightningAddress).toBeDefined();
      expect(typeof sdk.lightningAddress.handleLud16Request).toBe('function');
      expect(typeof sdk.lightningAddress.handleLnurlpCallback).toBe('function');
      expect(typeof sdk.lightningAddress.handleLnurlpVerify).toBe('function');
      expect(() => AgicashServerSdk.create(createConfig())).toThrow(
        /dispose\(\)/,
      );
    } finally {
      sdk.dispose();
    }

    const next = AgicashServerSdk.create(createConfig());
    const errorSpy = spyOn(console, 'error').mockImplementation(
      () => undefined,
    );
    try {
      const outOfRange = await next.lightningAddress.handleLnurlpCallback({
        userId: 'user-1',
        amount: new Money({ amount: 999, currency: 'BTC', unit: 'msat' }),
        baseUrl: 'https://pay.example',
      });
      expect(outOfRange).toEqual({
        status: 'ERROR',
        reason: `Amount out of range. Min: 1 sats, Max: ${(1_000_000).toLocaleString()} sats.`,
      });

      const garbage = await next.lightningAddress.handleLnurlpVerify({
        encryptedQuoteData: '%%%%',
      });
      expect(garbage).toEqual({
        status: 'ERROR',
        reason: 'Internal server error',
      });
    } finally {
      errorSpy.mockRestore();
      next.dispose();
    }
  });

  it('throws synchronously on an invalid hex key and leaves the slot empty', () => {
    expect(() => AgicashServerSdk.create(createConfig('zz'))).toThrow(/hex/i);

    const sdk = AgicashServerSdk.create(createConfig());
    sdk.dispose();
  });
});
