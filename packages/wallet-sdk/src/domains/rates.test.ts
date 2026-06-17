import { Money } from '@agicash/money';
import { describe, expect, test } from 'bun:test';
import type { ExchangeRateProvider } from '../internal/rates/providers/types';
import { ExchangeRateService } from '../internal/rates/exchange-rate-service';
import { RatesDomain } from './rates';

// A stub provider supporting BTC-USD / USD-BTC with a fixed rate.
const stubProvider: ExchangeRateProvider = {
  supportedTickers: ['BTC-USD', 'USD-BTC'],
  async getRates({ tickers }) {
    const out: Record<string, string> = { timestamp: '0' } as never;
    const rates: Record<string, string> = {
      'BTC-USD': '100000',
      'USD-BTC': '0.00001',
    };
    const result: { timestamp: number; [k: string]: string | number } = {
      timestamp: 0,
    };
    for (const t of tickers) result[t] = rates[t];
    return result as never;
  },
};

function makeDomain() {
  return new RatesDomain(new ExchangeRateService([stubProvider]));
}

describe('RatesDomain.get', () => {
  test('returns the decimal-string rate for a ticker', async () => {
    expect(await makeDomain().get('BTC-USD')).toBe('100000');
  });
  test('returns "1" for a same-currency ticker (short-circuit)', async () => {
    expect(await makeDomain().get('USD-USD')).toBe('1');
  });
});

describe('RatesDomain.convert', () => {
  test('converts an amount into the target currency using the fetched rate', async () => {
    const usd = await makeDomain().convert({
      amount: new Money({ amount: 1, currency: 'BTC', unit: 'btc' }),
      to: 'USD',
    });
    expect(usd.currency).toBe('USD');
    expect(usd.toNumber('usd')).toBe(100000);
  });
});
