import { describe, expect, mock, test } from 'bun:test';
import type { AgicashDb, AgicashDbUser } from './database';
import { ReadUserRepository, WriteUserRepository } from './user-repository';

const row = (overrides: Partial<AgicashDbUser> = {}): AgicashDbUser =>
  ({
    id: 'u1',
    username: 'alice',
    email: 'a@b.c',
    email_verified: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    cashu_locking_xpub: 'xpub',
    encryption_public_key: 'enc',
    spark_identity_public_key: 'spark',
    default_btc_account_id: 'btc',
    default_usd_account_id: null,
    default_currency: 'BTC',
    terms_accepted_at: null,
    gift_card_mint_terms_accepted_at: null,
    ...overrides,
  }) as AgicashDbUser;

describe('ReadUserRepository.toUser', () => {
  test('maps a full user', () => {
    const u = ReadUserRepository.toUser(row());
    expect(u).toMatchObject({ id: 'u1', isGuest: false, email: 'a@b.c' });
  });
  test('maps a guest (no email)', () => {
    const u = ReadUserRepository.toUser(row({ email: null }));
    expect(u.isGuest).toBe(true);
    expect('email' in u).toBe(false);
  });
});

describe('WriteUserRepository.upsert', () => {
  test('builds the RPC payload and maps only the user row', async () => {
    const rpc = mock(async () => ({
      data: { user: row(), accounts: [] },
      error: null,
    }));
    const db = { rpc } as unknown as AgicashDb;
    const repo = new WriteUserRepository(db);
    const result = await repo.upsert({
      id: 'u1',
      email: 'a@b.c',
      emailVerified: true,
      accounts: [
        {
          type: 'spark',
          currency: 'BTC',
          name: 'Bitcoin',
          network: 'MAINNET',
          isDefault: true,
          purpose: 'transactional',
          expiresAt: null,
        },
      ],
      cashuLockingXpub: 'xpub',
      encryptionPublicKey: 'enc',
      sparkIdentityPublicKey: 'spark',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    const call = rpc.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(call[0]).toBe('upsert_user_with_accounts');
    expect(call[1].p_user_id).toBe('u1');
    expect(result.id).toBe('u1');
  });
});
