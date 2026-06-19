import { afterAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { inMemoryStorageAdapter } from '../../storage/memory';
import type { Account } from '../domains/account-types';
import type { OpenSecret } from '../internal/opensecret';
import { createStatelessSdk } from './index';
import { ResidentAccounts } from './resident-accounts';

const acct = (
  id: string,
  currency = 'BTC',
  createdAt = '2024-01-01',
): Account =>
  ({ id, type: 'cashu', currency, createdAt, isOnline: true }) as Account;

// Variant A's engine constructs a real `ResidentAccounts` from `ctx.runtime` and
// exposes it as `engine.wallets`. Spy on its `all()` (instance-agnostic: it
// intercepts the instance the SDK builds internally) so the test can assert that
// `createStatelessSdk` captures that resident and wires it into
// `sdk.accounts.list()` — without driving a real DB load. A prototype spy is used
// rather than a module mock so it cannot leak across the suite (it is restored in
// afterAll, and the engine's static `ResidentAccounts` binding is left intact).
const seeded: Account[] = [acct('a', 'BTC', '2023-01-01'), acct('b', 'USD')];
const allSpy = spyOn(ResidentAccounts.prototype, 'all').mockReturnValue(seeded);

afterAll(() => allSpy.mockRestore());

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

describe('createStatelessSdk', () => {
  test('overrides sdk.accounts with the stateless surface (list + getDefault)', async () => {
    const sdk = await createStatelessSdk(baseConfig(), {
      openSecret: fakeOs(),
    });
    expect(typeof sdk.accounts.list).toBe('function');
    expect(typeof sdk.accounts.getDefault).toBe('function');
    await sdk.dispose();
  });

  test('list() resolves to the engine resident accounts', async () => {
    const sdk = await createStatelessSdk(baseConfig(), {
      openSecret: fakeOs(),
    });
    const accounts = await sdk.accounts.list();
    expect(accounts.map((a) => a.id)).toEqual(['a', 'b']);
    await sdk.dispose();
  });
});
