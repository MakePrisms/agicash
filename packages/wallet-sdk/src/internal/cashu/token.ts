import type { Token } from '@cashu/cashu-ts';
import { encodeToken, sumProofs } from '@agicash/cashu';
import { computeSHA256 } from '@agicash/ecies';
import { type Currency, type CurrencyUnit, Money } from '@agicash/money';

function getCurrencyAndUnitFromToken(token: Token): {
  currency: Currency;
  unit: CurrencyUnit;
  formatUnit: 'sat' | 'usd';
} {
  if (token.unit === 'sat') {
    return { currency: 'BTC', unit: 'sat', formatUnit: 'sat' };
  }
  if (token.unit === 'usd') {
    return { currency: 'USD', unit: 'cent', formatUnit: 'usd' };
  }
  throw new Error(`Invalid token unit ${token.unit}`);
}

export function tokenToMoney(token: Token): Money {
  const { currency, unit } = getCurrencyAndUnitFromToken(token);
  const amount = sumProofs(token.proofs);
  return new Money<Currency>({
    amount,
    currency,
    unit,
  });
}

export function getTokenHash(token: Token | string): Promise<string> {
  if (typeof token === 'string') {
    return computeSHA256(token);
  }
  return computeSHA256(encodeToken(token));
}
