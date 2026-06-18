import { describe, expect, mock, test } from 'bun:test';
import { inMemoryStorageAdapter } from '../storage/memory';
import type { OpenSecret } from './internal/opensecret';
import { Sdk } from './sdk';

const fakeOs = () =>
  ({
    configure: mock(() => {}),
    fetchUser: mock(async () => ({
      user: { id: 'u1', email: 'a@b.c', email_verified: true },
    })),
    getPrivateKey: mock(async () => ({ mnemonic: 'm' })),
    getPrivateKeyBytes: mock(async () => ({ private_key: '00'.repeat(32) })),
    getPublicKey: mock(async () => ({ public_key: 'p' })),
  }) as unknown as OpenSecret & { configure: ReturnType<typeof mock> };

const baseConfig = () => ({
  openSecret: { url: 'https://os.example', clientId: 'client' },
  supabase: { url: 'http://127.0.0.1:54321', anonKey: 'anon' },
  storage: inMemoryStorageAdapter(),
});

describe('Sdk.create', () => {
  test('configures Open Secret and exposes the auth domain', async () => {
    const os = fakeOs();
    const sdk = await Sdk.create(baseConfig(), { openSecret: os });
    expect(os.configure).toHaveBeenCalledTimes(1);
    expect(sdk.auth).toBeDefined();
    expect(sdk.accounts).toBeDefined();
    expect(sdk.contacts).toBeDefined();
    expect(sdk.transactions).toBeDefined();
    expect(sdk.transfers).toBeDefined();
    expect(sdk.cashu.send).toBeDefined();
    expect(sdk.cashu.receive).toBeDefined();
    expect(sdk.spark.send).toBeDefined();
    expect(sdk.spark.receive).toBeDefined();
    await sdk.dispose();
  });

  test('on() returns an unsubscribe function and resync/dispose resolve', async () => {
    const sdk = await Sdk.create(baseConfig(), { openSecret: fakeOs() });
    const off = sdk.on('auth:signed-out', () => {});
    expect(typeof off).toBe('function');
    off();
    await sdk.resync();
    await sdk.dispose();
  });
});
