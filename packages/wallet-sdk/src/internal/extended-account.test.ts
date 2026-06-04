import { describe, expect, test } from 'bun:test';
import { getExtendedAccounts, isDefaultAccount } from './extended-account';
import type { Account } from '../types/account';
import type { User } from '../types/user';

const user: User = {
  id: 'user-1',
  username: 'alice',
  isGuest: false,
  email: 'alice@example.com',
  emailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  defaultBtcAccountId: 'btc-default',
  defaultUsdAccountId: 'usd-default',
  defaultCurrency: 'BTC',
  cashuLockingXpub: 'xpub',
  encryptionPublicKey: 'enc',
  sparkIdentityPublicKey: 'spark',
  termsAcceptedAt: null,
  giftCardMintTermsAcceptedAt: null,
};

function account(opts: {
  id: string;
  currency?: 'BTC' | 'USD';
  createdAt?: string;
}): Account {
  return {
    id: opts.id,
    name: opts.id,
    type: 'cashu',
    purpose: 'transactional',
    state: 'active',
    isOnline: true,
    currency: opts.currency ?? 'BTC',
    createdAt: opts.createdAt ?? '2026-01-01T00:00:00.000Z',
    version: 1,
    expiresAt: null,
    mintUrl: `https://${opts.id}.example.com`,
    isTestMint: false,
    keysetCounters: {},
    proofs: [],
    wallet: {} as never,
  } as Account;
}

describe('isDefaultAccount', () => {
  test('BTC account matches defaultBtcAccountId', () => {
    expect(isDefaultAccount(user, account({ id: 'btc-default' }))).toBe(true);
    expect(isDefaultAccount(user, account({ id: 'other' }))).toBe(false);
  });

  test('USD account matches defaultUsdAccountId', () => {
    expect(
      isDefaultAccount(user, account({ id: 'usd-default', currency: 'USD' })),
    ).toBe(true);
  });

  test('per-currency: a USD account is NOT the default just because its id matches the BTC default', () => {
    // Same id, but currency USD → checked against defaultUsdAccountId, not BTC.
    expect(
      isDefaultAccount(user, account({ id: 'btc-default', currency: 'USD' })),
    ).toBe(false);
  });

  test('a null USD default never matches', () => {
    const noUsd: User = { ...user, defaultUsdAccountId: null };
    expect(
      isDefaultAccount(noUsd, account({ id: 'usd-default', currency: 'USD' })),
    ).toBe(false);
  });
});

describe('getExtendedAccounts', () => {
  test('flags isDefault per account and sorts the default to the top', () => {
    const a = account({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' });
    const def = account({
      id: 'btc-default',
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    const result = getExtendedAccounts(user, [a, def]);
    expect(result.map((x) => x.id)).toEqual(['btc-default', 'a']);
    expect(result.map((x) => x.isDefault)).toEqual([true, false]);
  });

  test('no default present → all false, order preserved', () => {
    const a = account({ id: 'a' });
    const b = account({ id: 'b' });
    const result = getExtendedAccounts(user, [a, b]);
    expect(result.map((x) => x.isDefault)).toEqual([false, false]);
    expect(result.map((x) => x.id)).toEqual(['a', 'b']);
  });

  test('flags one default per currency', () => {
    const btc = account({ id: 'btc-default', currency: 'BTC' });
    const usd = account({ id: 'usd-default', currency: 'USD' });
    const other = account({ id: 'other' });
    const result = getExtendedAccounts(user, [other, btc, usd]);
    const byId = new Map(result.map((a) => [a.id, a.isDefault]));
    expect(byId.get('btc-default')).toBe(true);
    expect(byId.get('usd-default')).toBe(true);
    expect(byId.get('other')).toBe(false);
  });
});
