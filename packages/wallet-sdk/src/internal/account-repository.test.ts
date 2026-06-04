import { describe, expect, test } from 'bun:test';
import { DeferredAccountHandleResolver } from './account-handle-resolver';
import { AccountRepository } from './account-repository';
import type { AgicashDbAccountWithProofs } from './db-account';
import type { WalletSupabaseClient } from './supabase-client';

// -- Fakes -------------------------------------------------------------------

/** Terminal result shape every builder call resolves to. */
type Result = { data: unknown; error: unknown; status?: number };

/**
 * A fake Supabase client whose fluent `from(...).select/insert/eq/returns/...` chain is a
 * no-op (records the last `insert(...)` payload) and whose terminal `single()` /
 * `maybeSingle()` — and the awaited builder itself (`getAllActive` awaits the query, not a
 * terminal) — resolve to a pre-set result. Only the methods the repository touches are
 * implemented; cast to the client type.
 */
function fakeDb(result: Result) {
  let lastInsert: unknown;
  const chain: Record<string, unknown> & PromiseLike<Result> = {
    select: () => chain,
    insert: (payload: unknown) => {
      lastInsert = payload;
      return chain;
    },
    eq: () => chain,
    returns: () => chain,
    single: async () => result,
    maybeSingle: async () => result,
    // Make the builder awaitable (the `getAllActive` list query is awaited directly) — a
    // PostgrestFilterBuilder IS a real thenable, so the mock must be one too.
    // biome-ignore lint/suspicious/noThenProperty: intentionally mocking the thenable Supabase query builder.
    then: (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  const db = {
    from: () => chain,
  } as unknown as WalletSupabaseClient;
  return { db, getLastInsert: () => lastInsert };
}

const resolver = new DeferredAccountHandleResolver();

const cashuRow: AgicashDbAccountWithProofs = {
  id: 'acct-cashu',
  name: 'My Mint',
  type: 'cashu',
  purpose: 'transactional',
  state: 'active',
  currency: 'BTC',
  details: {
    mint_url: 'https://mint.example.com',
    is_test_mint: false,
    keyset_counters: { abc: 3 },
  },
  created_at: '2026-01-01T00:00:00.000Z',
  expires_at: null,
  user_id: 'user-1',
  version: 2,
  cashu_proofs: [],
};

const sparkRow: AgicashDbAccountWithProofs = {
  id: 'acct-spark',
  name: 'Spark',
  type: 'spark',
  purpose: 'transactional',
  state: 'active',
  currency: 'BTC',
  details: { network: 'MAINNET' },
  created_at: '2026-01-02T00:00:00.000Z',
  expires_at: null,
  user_id: 'user-1',
  version: 1,
  cashu_proofs: [],
};

describe('AccountRepository.get', () => {
  test('maps a cashu account row to the domain account (handle deferred)', async () => {
    const { db } = fakeDb({ data: cashuRow, error: null });
    const repo = new AccountRepository(db, resolver);

    const account = await repo.get('acct-cashu');

    expect(account).not.toBeNull();
    expect(account?.type).toBe('cashu');
    if (account?.type === 'cashu') {
      expect(account.mintUrl).toBe('https://mint.example.com');
      expect(account.isTestMint).toBe(false);
      expect(account.keysetCounters).toEqual({ abc: 3 });
      // Deferred to Slice 3: proofs empty, account reported offline.
      expect(account.proofs).toEqual([]);
      expect(account.isOnline).toBe(false);
    }
  });

  test('maps a spark account row (balance deferred to null)', async () => {
    const { db } = fakeDb({ data: sparkRow, error: null });
    const repo = new AccountRepository(db, resolver);

    const account = await repo.get('acct-spark');

    expect(account?.type).toBe('spark');
    if (account?.type === 'spark') {
      expect(account.network).toBe('MAINNET');
      expect(account.balance).toBeNull();
      expect(account.isOnline).toBe(false);
    }
  });

  test('returns null when no row exists', async () => {
    const { db } = fakeDb({ data: null, error: null });
    const repo = new AccountRepository(db, resolver);

    expect(await repo.get('missing')).toBeNull();
  });

  test('throws on a read error', async () => {
    const { db } = fakeDb({ data: null, error: { message: 'boom' } });
    const repo = new AccountRepository(db, resolver);

    await expect(repo.get('acct-cashu')).rejects.toThrow(
      'Failed to get account',
    );
  });
});

describe('AccountRepository.getAllActive', () => {
  test('maps every returned row', async () => {
    const { db } = fakeDb({ data: [cashuRow, sparkRow], error: null });
    const repo = new AccountRepository(db, resolver);

    const accounts = await repo.getAllActive('user-1');

    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.id)).toEqual(['acct-cashu', 'acct-spark']);
  });

  test('throws on a read error', async () => {
    const { db } = fakeDb({ data: null, error: { message: 'boom' } });
    const repo = new AccountRepository(db, resolver);

    await expect(repo.getAllActive('user-1')).rejects.toThrow(
      'Failed to get accounts',
    );
  });
});

describe('AccountRepository.add', () => {
  test('builds the cashu insert row (normalised mint url + empty counters)', async () => {
    const { db, getLastInsert } = fakeDb({ data: cashuRow, error: null });
    const repo = new AccountRepository(db, resolver);

    const account = await repo.add('user-1', {
      type: 'cashu',
      mintUrl: 'https://mint.example.com/', // trailing slash → normalised
      currency: 'BTC',
    });

    const inserted = getLastInsert() as {
      type: string;
      currency: string;
      user_id: string;
      purpose: string;
      expires_at: string | null;
      details: { mint_url: string; is_test_mint: boolean };
    };
    expect(inserted.type).toBe('cashu');
    expect(inserted.currency).toBe('BTC');
    expect(inserted.user_id).toBe('user-1');
    expect(inserted.purpose).toBe('transactional');
    expect(inserted.expires_at).toBeNull();
    expect(inserted.details.mint_url).toBe('https://mint.example.com');
    expect(account.type).toBe('cashu');
  });

  test('builds the spark insert row (network MAINNET, default name)', async () => {
    const { db, getLastInsert } = fakeDb({ data: sparkRow, error: null });
    const repo = new AccountRepository(db, resolver);

    await repo.add('user-1', { type: 'spark', currency: 'BTC' });

    const inserted = getLastInsert() as {
      type: string;
      name: string;
      details: { network: string };
    };
    expect(inserted.type).toBe('spark');
    expect(inserted.name).toBe('Spark');
    expect(inserted.details.network).toBe('MAINNET');
  });

  test('a 409 on a cashu insert → DomainError (account already exists)', async () => {
    const { db } = fakeDb({
      data: null,
      error: { message: 'conflict' },
      status: 409,
    });
    const repo = new AccountRepository(db, resolver);

    const promise = repo.add('user-1', {
      type: 'cashu',
      mintUrl: 'https://mint.example.com',
      currency: 'BTC',
    });
    await expect(promise).rejects.toMatchObject({
      code: 'ACCOUNT_ALREADY_EXISTS',
    });
  });

  test('a LIMIT_REACHED hint → DomainError', async () => {
    const { db } = fakeDb({
      data: null,
      error: { message: 'too many', hint: 'LIMIT_REACHED', details: 'max 1' },
    });
    const repo = new AccountRepository(db, resolver);

    const promise = repo.add('user-1', {
      type: 'cashu',
      mintUrl: 'https://mint.example.com',
      currency: 'BTC',
    });
    await expect(promise).rejects.toMatchObject({
      code: 'ACCOUNT_LIMIT_REACHED',
    });
  });

  test('a non-conflict insert error → generic Error', async () => {
    const { db } = fakeDb({
      data: null,
      error: { message: 'boom' },
      status: 500,
    });
    const repo = new AccountRepository(db, resolver);

    await expect(
      repo.add('user-1', { type: 'spark', currency: 'BTC' }),
    ).rejects.toThrow('Failed to create account');
  });
});
