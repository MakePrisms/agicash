import { describe, expect, test } from 'bun:test';
import { DomainError, NotFoundError } from '../errors';
import type { AgicashDbUser } from './db-user';
import type { WalletSupabaseClient } from './supabase-client';
import { UserRepository } from './user-repository';

/** A representative `wallet.users` row. */
const row: AgicashDbUser = {
  id: 'user-1',
  username: 'alice',
  email: 'alice@example.com',
  email_verified: true,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-02T00:00:00.000Z',
  default_btc_account_id: 'btc-acct',
  default_usd_account_id: null,
  default_currency: 'BTC',
  cashu_locking_xpub: 'xpub-1',
  encryption_public_key: 'enc-pk',
  spark_identity_public_key: 'spark-pk',
  terms_accepted_at: null,
  gift_card_mint_terms_accepted_at: null,
};

/** The shape every terminal builder call (`single`/`maybeSingle`) resolves to. */
type Result = { data: unknown; error: unknown };

/**
 * A fake Supabase client whose fluent `from(...).select/update/eq/...` chain is a no-op and
 * whose terminal `single()` / `maybeSingle()` resolve to a pre-set result. Records the last
 * `update(...)` payload so tests can assert what was written. Cast to the client type — only
 * the methods the repository touches are implemented.
 */
function fakeDb(result: Result) {
  let lastUpdate: unknown;
  const chain: Record<string, unknown> = {
    select: () => chain,
    update: (payload: unknown) => {
      lastUpdate = payload;
      return chain;
    },
    eq: () => chain,
    single: async () => result,
    maybeSingle: async () => result,
  };
  const db = {
    from: () => chain,
  } as unknown as WalletSupabaseClient;
  return { db, getLastUpdate: () => lastUpdate };
}

describe('UserRepository.get', () => {
  test('returns the mapped domain user for an existing row', async () => {
    const { db } = fakeDb({ data: row, error: null });
    const repo = new UserRepository(db);

    const user = await repo.get('user-1');

    expect(user.id).toBe('user-1');
    expect(user.username).toBe('alice');
    expect(user.isGuest).toBe(false);
  });

  test('throws NotFoundError when no row exists', async () => {
    const { db } = fakeDb({ data: null, error: null });
    const repo = new UserRepository(db);

    await expect(repo.get('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  test('throws on a read error', async () => {
    const { db } = fakeDb({ data: null, error: { message: 'boom' } });
    const repo = new UserRepository(db);

    await expect(repo.get('user-1')).rejects.toThrow('Failed to get user');
  });
});

describe('UserRepository.updateUsername', () => {
  test('writes the username and returns the updated user', async () => {
    const updatedRow = { ...row, username: 'bob' };
    const { db, getLastUpdate } = fakeDb({ data: updatedRow, error: null });
    const repo = new UserRepository(db);

    const user = await repo.updateUsername('user-1', 'bob');

    expect(getLastUpdate()).toEqual({ username: 'bob' });
    expect(user.username).toBe('bob');
  });

  test('throws DomainError when the username is taken (unique violation 23505)', async () => {
    const { db } = fakeDb({
      data: null,
      error: { code: '23505', message: 'duplicate key value' },
    });
    const repo = new UserRepository(db);

    const promise = repo.updateUsername('user-1', 'taken');
    await expect(promise).rejects.toBeInstanceOf(DomainError);
    await expect(promise).rejects.toThrow('already taken');
  });

  test('throws a generic error for a non-unique-violation failure', async () => {
    const { db } = fakeDb({
      data: null,
      error: { code: '500', message: 'server error' },
    });
    const repo = new UserRepository(db);

    const promise = repo.updateUsername('user-1', 'bob');
    await expect(promise).rejects.toThrow('Failed to update user');
    await expect(promise).rejects.not.toBeInstanceOf(DomainError);
  });
});
