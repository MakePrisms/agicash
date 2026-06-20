import { describe, expect, mock, test } from 'bun:test';
import { inMemoryStorageAdapter } from '../../storage/memory';
import type { OpenSecret } from '../internal/opensecret';
import type { StoreAccounts } from './accounts-surface';
import { createStoreSdk } from './index';

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

const isStore = (x: unknown): boolean =>
  typeof (x as { toPromise?: unknown })?.toPromise === 'function';

describe('createStoreSdk', () => {
  test('augments sdk.accounts with the store accounts surface (all + list + getDefault)', async () => {
    const sdk = await createStoreSdk(baseConfig(), { openSecret: fakeOs() });
    const accounts = sdk.accounts as StoreAccounts;
    expect(typeof accounts.list).toBe('function');
    expect(typeof accounts.getDefault).toBe('function');
    expect(isStore(accounts.all)).toBe(true);
    await sdk.dispose();
  });

  test('exposes the public Store hot reads on the domains', async () => {
    const sdk = await createStoreSdk(baseConfig(), { openSecret: fakeOs() });
    expect(isStore(sdk.user.current)).toBe(true);
    expect(isStore(sdk.contacts.all)).toBe(true);
    expect(isStore(sdk.cashu.send.unresolved)).toBe(true);
    expect(isStore(sdk.cashu.receive.pending)).toBe(true);
    expect(isStore(sdk.spark.send.unresolved)).toBe(true);
    expect(isStore(sdk.spark.receive.pending)).toBe(true);
    await sdk.dispose();
  });
});
