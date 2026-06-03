import { describe, expect, test } from 'bun:test';
import type { CashuAccount, SparkAccount } from '../types/account';
import { Money } from '../types/money';
import { getAccountBalance } from './account-balance';

function cashu(proofAmounts: number[], currency: 'BTC' | 'USD' = 'BTC') {
  return {
    type: 'cashu',
    currency,
    proofs: proofAmounts.map((amount) => ({ amount })),
  } as unknown as CashuAccount;
}

describe('getAccountBalance', () => {
  test('cashu: sums proof amounts into Money (BTC → sat)', () => {
    const balance = getAccountBalance(cashu([100, 250, 1]));
    expect(balance).not.toBeNull();
    expect(balance?.toNumber('sat')).toBe(351);
    expect(balance?.currency).toBe('BTC');
  });

  test('cashu: USD proofs sum into cents', () => {
    const balance = getAccountBalance(cashu([100, 50], 'USD'));
    // cashu unit for USD is 'cent'.
    expect(balance?.toNumber('cent')).toBe(150);
    expect(balance?.currency).toBe('USD');
  });

  test('cashu: empty account → zero balance (not null)', () => {
    const balance = getAccountBalance(cashu([]));
    expect(balance).not.toBeNull();
    expect(balance?.toNumber('sat')).toBe(0);
  });

  test('spark: returns the balance field', () => {
    const account = {
      type: 'spark',
      currency: 'BTC',
      balance: new Money({ amount: 5000, currency: 'BTC', unit: 'sat' }),
    } as unknown as SparkAccount;
    expect(getAccountBalance(account)?.toNumber('sat')).toBe(5000);
  });

  test('spark: null balance passes through as null', () => {
    const account = {
      type: 'spark',
      currency: 'BTC',
      balance: null,
    } as unknown as SparkAccount;
    expect(getAccountBalance(account)).toBeNull();
  });
});
