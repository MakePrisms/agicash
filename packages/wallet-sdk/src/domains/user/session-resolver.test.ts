import { afterAll, describe, expect, it, mock, test } from 'bun:test';
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

const { resolveSession, resolveSessionRequired, hasUserChanged } = await import(
  './session-resolver'
);
import type { SdkConfig } from '../../config';
import { DomainError, SdkError } from '../../errors';
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

type CtxOpts = {
  db: ReturnType<typeof makeFakeDb>;
  loggedIn?: boolean;
  sleep?: (ms: number) => Promise<void>;
};

function ctx(
  opts: CtxOpts | ReturnType<typeof makeFakeDb>,
  loggedIn = true,
): DomainContext {
  // Allow legacy call style: ctx(db) or ctx(db, loggedIn)
  const isOpts = opts !== null && typeof opts === 'object' && 'db' in opts;
  const db = isOpts
    ? (opts as CtxOpts).db
    : (opts as ReturnType<typeof makeFakeDb>);
  const isLoggedIn = isOpts ? ((opts as CtxOpts).loggedIn ?? true) : loggedIn;
  const sleep = isOpts ? (opts as CtxOpts).sleep : undefined;

  const storage = isLoggedIn
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
    connections: {
      supabase: db,
      keys,
    } as unknown as DomainContext['connections'],
    emitter: new SdkEventEmitter(),
    _sleep: sleep,
  };
}

describe('hasUserChanged', () => {
  it('detects email drift', () => {
    const guest = { isGuest: true, emailVerified: false } as never;
    expect(
      hasUserChanged(guest, {
        id: 'u1',
        email: 'a@b.co',
        email_verified: false,
      }),
    ).toBe(true);
  });
  it('detects verified drift', () => {
    const full = {
      isGuest: false,
      email: 'a@b.co',
      emailVerified: false,
    } as never;
    expect(
      hasUserChanged(full, { id: 'u1', email: 'a@b.co', email_verified: true }),
    ).toBe(true);
  });
  it('no drift → false', () => {
    const guest = { isGuest: true, emailVerified: false } as never;
    expect(hasUserChanged(guest, { id: 'u1', email_verified: false })).toBe(
      false,
    );
  });
});

describe('resolveSession', () => {
  it('returns null when not logged in', async () => {
    const db = makeFakeDb({ selectResult: { data: null, error: null } });
    expect(await resolveSession(ctx(db, false))).toBeNull();
  });

  it('returns the existing row when there is no drift (no upsert)', async () => {
    const calls = { rpc: [] as Array<{ name: string; args: unknown }> };
    const db = makeFakeDb({
      selectResult: { data: guestRow, error: null },
      calls,
    });
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

  it('bootstraps (upsert) when the existing row has drifted', async () => {
    const calls = { rpc: [] as Array<{ name: string; args: unknown }> };
    const driftedRow = { ...guestRow, email_verified: true };
    const db = makeFakeDb({
      selectResult: { data: driftedRow, error: null },
      rpcResult: { data: { user: guestRow, accounts: [] }, error: null },
      calls,
    });
    const user = await resolveSession(ctx(db));
    expect(user?.id).toBe('u1');
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0]?.name).toBe('upsert_user_with_accounts');
  });
});

describe('resolveSessionRequired', () => {
  it('throws SdkError(SESSION_RESOLUTION_FAILED) when no session resolves', async () => {
    const db = makeFakeDb({ selectResult: { data: null, error: null } });
    await expect(resolveSessionRequired(ctx(db, false))).rejects.toMatchObject({
      code: 'SESSION_RESOLUTION_FAILED',
    });
  });
});

describe('bootstrapUser retry', () => {
  test('retries the upsert on a transient failure then succeeds', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const db = makeFakeDb({
      selectResult: { data: null, error: null },
      rpc: () => {
        calls += 1;
        if (calls === 1) throw new SdkError('boom', 'UNKNOWN');
        return { data: { user: guestRow, accounts: [] }, error: null };
      },
    });
    const user = await resolveSession(
      ctx({
        db,
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      }),
    );
    expect(user?.id).toBe('u1');
    expect(calls).toBe(2);
    expect(sleeps).toEqual([500]);
  });

  test('exhausts retries and throws after 3 attempts', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const db = makeFakeDb({
      selectResult: { data: null, error: null },
      rpc: () => {
        calls += 1;
        throw new SdkError('always fails', 'UNKNOWN');
      },
    });
    await expect(
      resolveSession(
        ctx({
          db,
          sleep: (ms) => {
            sleeps.push(ms);
            return Promise.resolve();
          },
        }),
      ),
    ).rejects.toBeInstanceOf(SdkError);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  test('does NOT retry on a DomainError (e.g. 23505)', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const db = makeFakeDb({
      selectResult: { data: null, error: null },
      rpc: () => {
        calls += 1;
        throw new DomainError('dup', 'UNIQUE_CONSTRAINT');
      },
    });
    await expect(
      resolveSession(
        ctx({
          db,
          sleep: (ms) => {
            sleeps.push(ms);
            return Promise.resolve();
          },
        }),
      ),
    ).rejects.toBeInstanceOf(DomainError);
    expect(calls).toBe(1);
    expect(sleeps).toHaveLength(0);
  });
});
