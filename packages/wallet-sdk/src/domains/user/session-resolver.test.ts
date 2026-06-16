import { afterAll, describe, expect, it, mock } from 'bun:test';
import {
  breezModuleMock,
  inMemoryStorage,
  jwtWith,
  makeFakeDb,
  openSecretModuleMock,
} from '../../internal/test-support';

mock.module('@agicash/opensecret', () =>
  openSecretModuleMock({
    fetchUser: async () => ({ user: { id: 'u1', email_verified: false } }),
  }),
);
mock.module('@agicash/breez-sdk-spark', () => breezModuleMock());
afterAll(() => mock.restore());

const { resolveSession, hasUserChanged } = await import('./session-resolver');
import type { SdkConfig } from '../../config';
import type { KeyProvider } from '../../internal/crypto/keys';
import { SdkEventEmitter } from '../../internal/event-emitter';
import type { DomainContext } from '../context';

const guestRow = {
  id: 'u1',
  username: 'alice',
  email: null,
  email_verified: false,
  created_at: 't',
  updated_at: 't',
  cashu_locking_xpub: 'x',
  encryption_public_key: 'e',
  spark_identity_public_key: 's',
  default_btc_account_id: 'btc',
  default_usd_account_id: null,
  default_currency: 'BTC',
  terms_accepted_at: null,
  gift_card_mint_terms_accepted_at: null,
};

const keys: KeyProvider = {
  getChildMnemonic: async () =>
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  getPrivateKeyBytes: async () => new Uint8Array(32),
  getPublicKeyHex: async () => 'enc-pub',
};

function ctx(db: ReturnType<typeof makeFakeDb>, loggedIn = true): DomainContext {
  const storage = loggedIn
    ? inMemoryStorage({
        access_token: jwtWith({ sub: 'u1' }),
        refresh_token: jwtWith({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      })
    : inMemoryStorage();
  return {
    config: {
      defaultAccounts: [
        {
          type: 'spark',
          currency: 'BTC',
          name: 'Bitcoin',
          network: 'MAINNET',
          purpose: 'transactional',
          isDefault: true,
        },
      ],
      storage,
    } as unknown as SdkConfig,
    connections: { supabase: db, keys } as unknown as DomainContext['connections'],
    emitter: new SdkEventEmitter(),
  };
}

describe('hasUserChanged', () => {
  it('detects email drift', () => {
    const guest = { isGuest: true, emailVerified: false } as never;
    expect(
      hasUserChanged(guest, { id: 'u1', email: 'a@b.co', email_verified: false }),
    ).toBe(true);
  });
  it('detects verified drift', () => {
    const full = { isGuest: false, email: 'a@b.co', emailVerified: false } as never;
    expect(
      hasUserChanged(full, { id: 'u1', email: 'a@b.co', email_verified: true }),
    ).toBe(true);
  });
  it('no drift → false', () => {
    const guest = { isGuest: true, emailVerified: false } as never;
    expect(hasUserChanged(guest, { id: 'u1', email_verified: false })).toBe(false);
  });
});

describe('resolveSession', () => {
  it('returns null when not logged in', async () => {
    const db = makeFakeDb({ selectResult: { data: null, error: null } });
    expect(await resolveSession(ctx(db, false))).toBeNull();
  });

  it('returns the existing row when there is no drift (no upsert)', async () => {
    const calls = { rpc: [] as Array<{ name: string; args: unknown }> };
    const db = makeFakeDb({ selectResult: { data: guestRow, error: null }, calls });
    const user = await resolveSession(ctx(db));
    expect(user?.id).toBe('u1');
    expect(calls.rpc).toHaveLength(0);
  });

  it('bootstraps (upsert) when the row is missing', async () => {
    const calls = { rpc: [] as Array<{ name: string; args: unknown }> };
    const db = makeFakeDb({
      selectResult: { data: null, error: null },
      rpcResult: { data: { user: guestRow, accounts: [] }, error: null },
      calls,
    });
    const user = await resolveSession(ctx(db), {
      termsAcceptedAt: '2026-06-16T00:00:00Z',
    });
    expect(user?.id).toBe('u1');
    expect(calls.rpc[0]?.name).toBe('upsert_user_with_accounts');
    const args = calls.rpc[0]?.args as Record<string, unknown>;
    expect(String(args.p_cashu_locking_xpub).startsWith('xpub')).toBe(true);
    expect(args.p_encryption_public_key).toBe('enc-pub');
    expect(args.p_spark_identity_public_key).toBe('07');
    expect(args.p_terms_accepted_at).toBe('2026-06-16T00:00:00Z');
    expect((args.p_accounts as unknown[]).length).toBe(1);
  });
});
