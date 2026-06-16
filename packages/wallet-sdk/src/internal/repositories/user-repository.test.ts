import { describe, expect, it } from 'bun:test';
import { DomainError } from '../../errors';
import { makeFakeDb } from '../test-support';
import { UserRepository } from './user-repository';

const dbRow = {
  id: 'u1',
  username: 'alice',
  email: 'a@b.co',
  email_verified: true,
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

describe('UserRepository', () => {
  it('get() maps a row → User and queries the users table', async () => {
    const calls = { from: [] as string[] };
    const repo = new UserRepository(
      makeFakeDb({ selectResult: { data: dbRow, error: null }, calls }),
    );
    const user = await repo.get('u1');
    expect(user?.id).toBe('u1');
    expect(calls.from).toContain('users');
  });

  it('get() returns null when the row is absent', async () => {
    const repo = new UserRepository(
      makeFakeDb({ selectResult: { data: null, error: null } }),
    );
    expect(await repo.get('missing')).toBeNull();
  });

  it('update() rejects with DomainError on a unique-violation (taken username)', async () => {
    const repo = new UserRepository(
      makeFakeDb({
        updateResult: {
          data: null,
          error: { code: '23505', message: 'duplicate key' },
        },
      }),
    );
    await expect(
      repo.update('u1', { username: 'taken' }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('update() sends only the provided fields', async () => {
    const calls = { update: [] as unknown[] };
    const repo = new UserRepository(
      makeFakeDb({ updateResult: { data: dbRow, error: null }, calls }),
    );
    await repo.update('u1', { username: 'bob' });
    expect(calls.update[0]).toEqual({ username: 'bob' });
  });

  it('upsert() calls the RPC with the full payload and maps the result', async () => {
    const calls = { rpc: [] as Array<{ name: string; args: unknown }> };
    const repo = new UserRepository(
      makeFakeDb({
        rpcResult: { data: { user: dbRow, accounts: [] }, error: null },
        calls,
      }),
    );
    const user = await repo.upsert({
      id: 'u1',
      email: 'a@b.co',
      emailVerified: true,
      accounts: [],
      cashuLockingXpub: 'xpub',
      encryptionPublicKey: 'enc',
      sparkIdentityPublicKey: 'spark',
      termsAcceptedAt: '2026-06-16T00:00:00Z',
    });
    expect(user.id).toBe('u1');
    expect(calls.rpc[0]?.name).toBe('upsert_user_with_accounts');
    const args = calls.rpc[0]?.args as Record<string, unknown>;
    expect(args.p_user_id).toBe('u1');
    expect(args.p_email).toBe('a@b.co');
    expect(args.p_cashu_locking_xpub).toBe('xpub');
    expect(args.p_spark_identity_public_key).toBe('spark');
    expect(args.p_terms_accepted_at).toBe('2026-06-16T00:00:00Z');
    expect('p_gift_card_mint_terms_accepted_at' in args).toBe(false);
  });
});
