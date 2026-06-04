import { describe, expect, test } from 'bun:test';
import { type AgicashDbUser, dbUserToUser } from './db-user';

/** A complete `wallet.users` row with an email (a full user). */
const fullRow: AgicashDbUser = {
  id: 'user-1',
  username: 'alice',
  email: 'alice@example.com',
  email_verified: true,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-02T00:00:00.000Z',
  default_btc_account_id: 'btc-acct',
  default_usd_account_id: 'usd-acct',
  default_currency: 'BTC',
  cashu_locking_xpub: 'xpub-1',
  encryption_public_key: 'enc-pk',
  spark_identity_public_key: 'spark-pk',
  terms_accepted_at: '2024-01-01T00:00:00.000Z',
  gift_card_mint_terms_accepted_at: null,
};

describe('dbUserToUser', () => {
  test('maps a row with an email to a FullUser (isGuest: false)', () => {
    const user = dbUserToUser(fullRow);

    expect(user.isGuest).toBe(false);
    // narrow for the email field
    if (user.isGuest === false) {
      expect(user.email).toBe('alice@example.com');
    }
    expect(user.id).toBe('user-1');
    expect(user.username).toBe('alice');
    expect(user.emailVerified).toBe(true);
    expect(user.createdAt).toBe('2024-01-01T00:00:00.000Z');
    expect(user.updatedAt).toBe('2024-01-02T00:00:00.000Z');
    expect(user.defaultBtcAccountId).toBe('btc-acct');
    expect(user.defaultUsdAccountId).toBe('usd-acct');
    expect(user.defaultCurrency).toBe('BTC');
    expect(user.cashuLockingXpub).toBe('xpub-1');
    expect(user.encryptionPublicKey).toBe('enc-pk');
    expect(user.sparkIdentityPublicKey).toBe('spark-pk');
    expect(user.termsAcceptedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(user.giftCardMintTermsAcceptedAt).toBeNull();
  });

  test('maps a row with no email to a GuestUser (isGuest: true)', () => {
    const user = dbUserToUser({ ...fullRow, email: null });

    expect(user.isGuest).toBe(true);
    expect('email' in user).toBe(false);
  });

  test('defaults a null default_btc_account_id to an empty string', () => {
    const user = dbUserToUser({ ...fullRow, default_btc_account_id: null });
    expect(user.defaultBtcAccountId).toBe('');
  });

  test('passes through a null default_usd_account_id as null', () => {
    const user = dbUserToUser({ ...fullRow, default_usd_account_id: null });
    expect(user.defaultUsdAccountId).toBeNull();
  });
});
