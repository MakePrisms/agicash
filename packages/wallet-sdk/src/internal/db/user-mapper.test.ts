import { describe, expect, it } from 'bun:test';
import type { AgicashDbUser } from './database';
import { toUser } from './user-mapper';

function row(overrides: Partial<AgicashDbUser> = {}): AgicashDbUser {
  return {
    id: 'u1',
    username: 'alice',
    email: null,
    email_verified: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    cashu_locking_xpub: 'xpub-1',
    encryption_public_key: 'enc-1',
    spark_identity_public_key: 'spark-1',
    default_btc_account_id: 'btc-acc',
    default_usd_account_id: null,
    default_currency: 'BTC',
    terms_accepted_at: null,
    gift_card_mint_terms_accepted_at: null,
    ...overrides,
  } as AgicashDbUser;
}

describe('toUser', () => {
  it('maps a full (email) user → FullUser', () => {
    const user = toUser(row({ email: 'a@b.co', email_verified: true }));
    expect(user.isGuest).toBe(false);
    if (!user.isGuest) {
      expect(user.email).toBe('a@b.co');
    }
    expect(user.emailVerified).toBe(true);
    expect(user.defaultBtcAccountId).toBe('btc-acc');
  });

  it('maps an emailless row → GuestUser', () => {
    const user = toUser(row({ email: null }));
    expect(user.isGuest).toBe(true);
  });

  it('coerces a null default_btc_account_id to empty string', () => {
    const user = toUser(row({ default_btc_account_id: null }));
    expect(user.defaultBtcAccountId).toBe('');
  });
});
