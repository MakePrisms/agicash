import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import { DomainError } from '../../errors';
import type { Account } from '../../types/account';
import type { PaymentIntent } from '../../types/scan';
import { suggestForAccounts } from './suggest';

const btcMoney = (sats: number): Money =>
  new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as unknown as Money;

const spark = (id: string, sats: number, over: Partial<Account> = {}): Account =>
  ({
    id,
    name: id,
    type: 'spark',
    currency: 'BTC',
    purpose: 'transactional',
    state: 'active',
    isOnline: true,
    createdAt: 't',
    version: 1,
    expiresAt: null,
    balance: btcMoney(sats),
    network: 'MAINNET',
    wallet: {} as never,
    ...over,
  }) as Account;

const sendIntent = (sats: number): PaymentIntent => ({
  kind: 'send',
  destination: { kind: 'ln-address', address: 'a@b.co' },
  amount: btcMoney(sats),
});

describe('suggestForAccounts', () => {
  it('recommends the first sufficient candidate (array order = priority)', () => {
    const result = suggestForAccounts(sendIntent(100), [
      spark('a', 1000),
      spark('b', 2000),
    ]);
    expect(result.recommended.id).toBe('a');
    expect(result.alternatives.map((x) => x.id)).toEqual(['b']);
    expect(result.insufficient).toHaveLength(0);
  });

  it('puts under-funded accounts in `insufficient`', () => {
    const result = suggestForAccounts(sendIntent(1500), [
      spark('a', 1000),
      spark('b', 2000),
    ]);
    expect(result.recommended.id).toBe('b');
    expect(result.insufficient.map((x) => x.id)).toEqual(['a']);
  });

  it('prefers an offer/gift-card account over transactional', () => {
    const result = suggestForAccounts(sendIntent(100), [
      spark('plain', 1000),
      spark('gift', 1000, { purpose: 'gift-card' }),
    ]);
    expect(result.recommended.id).toBe('gift');
    expect(result.reason).toBe('gift-card-mint match');
  });

  it('throws DomainError when no candidate can serve', () => {
    expect(() =>
      suggestForAccounts(sendIntent(100), [
        spark('off', 1000, { isOnline: false, type: 'cashu', isTestMint: true } as never),
      ]),
    ).toThrow(DomainError);
  });

  it('throws DomainError when none has sufficient balance', () => {
    expect(() => suggestForAccounts(sendIntent(5000), [spark('a', 1000)])).toThrow(
      DomainError,
    );
  });
});
