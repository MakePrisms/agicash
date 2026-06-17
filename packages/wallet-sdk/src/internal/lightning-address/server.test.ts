import { describe, expect, test } from 'bun:test';
import { createServerSdk } from '../../server';

describe('createServerSdk', () => {
  test('builds a server SDK with a lightningAddress domain and dispose, without I/O', async () => {
    const sdk = await createServerSdk({
      supabase: {
        url: 'https://example.supabase.co',
        serviceRoleKey: 'service-role-key',
      },
      breezApiKey: 'breez-key',
      lightningAddress: {
        serverSparkMnemonic:
          'test test test test test test test test test test test junk',
        verifyEncryptionKey: '00'.repeat(32),
      },
    });
    expect(typeof sdk.lightningAddress.handleLud16Request).toBe('function');
    expect(typeof sdk.lightningAddress.handleLnurlpCallback).toBe('function');
    expect(typeof sdk.lightningAddress.handleLnurlpVerify).toBe('function');
    await sdk.dispose();
  });
});
