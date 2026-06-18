import { describe, expect, it } from 'bun:test';
import type { Account } from '../../domains/account-types';
import { isClaimingToSameCashuAccount } from './receive-cashu-token-models';

const cashu = (mintUrl: string, currency: 'BTC' | 'USD' = 'BTC') =>
  ({ type: 'cashu', currency, mintUrl }) as unknown as Account;
const spark = () => ({ type: 'spark', currency: 'BTC' }) as unknown as Account;

describe('isClaimingToSameCashuAccount', () => {
  it('is true for two cashu accounts on the same mint + currency', () => {
    expect(
      isClaimingToSameCashuAccount(
        cashu('https://mint.example/'),
        cashu('https://mint.example'),
      ),
    ).toBe(true); // areMintUrlsEqual normalizes the trailing slash
  });

  it('is false when currencies differ', () => {
    expect(
      isClaimingToSameCashuAccount(
        cashu('https://mint.example', 'BTC'),
        cashu('https://mint.example', 'USD'),
      ),
    ).toBe(false);
  });

  it('is false when mint URLs differ', () => {
    expect(
      isClaimingToSameCashuAccount(
        cashu('https://a.example'),
        cashu('https://b.example'),
      ),
    ).toBe(false);
  });

  it('is false when either account is not cashu', () => {
    expect(
      isClaimingToSameCashuAccount(cashu('https://mint.example'), spark()),
    ).toBe(false);
  });
});
