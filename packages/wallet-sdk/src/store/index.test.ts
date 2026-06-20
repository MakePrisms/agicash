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

  // Regression: the entry must NOT seed the stores to a placeholder. `getUser`
  // is deferred to `sdkReady`, so the mount-fetch fired during createEngine
  // stays pending until Sdk.create resolves and then reads the REAL wired
  // source (`sdk.user.get()` / the repos), never the old `async () => null`
  // placeholder. With the placeholder bug, `sdk.user.current.get()` was already
  // `null` (a stale seed) the instant createStoreSdk returned; here it must be
  // `undefined` (still loading), and only the real values resolve via toPromise.
  test('user store loads the REAL wired source, never a placeholder seed', async () => {
    const sdk = await createStoreSdk(baseConfig(), { openSecret: fakeOs() });

    // No synchronous placeholder seed: the mount-fetch is still pending. The
    // probe (against both old + fixed code, signed-out fixture) confirmed this
    // is deterministic — old code seeds `null` here, the fix leaves `undefined`.
    expect(sdk.user.current.get()).toBeUndefined();

    // The real wired source resolves. The fixture has no refresh token, so the
    // SDK is signed out: `sdk.user.get()` -> null and each list repo is skipped
    // -> []. These are the REAL values for this state (not a stray placeholder).
    // A logged-in non-null user would require a live DB (no injection seam on
    // Sdk.create), so that path is covered by stores.test.ts in isolation.
    expect(await sdk.user.current.toPromise()).toBeNull();
    expect(await sdk.accounts.all.toPromise()).toEqual([]);
    expect(await sdk.contacts.all.toPromise()).toEqual([]);

    await sdk.dispose();
  });
});
