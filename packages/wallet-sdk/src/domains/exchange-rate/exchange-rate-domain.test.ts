import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { createExchangeRateDomain } from './exchange-rate-domain';
import type { ExchangeRateService } from './exchange-rate-service';

const fakeService = {
  getRates: async ({ tickers }: { tickers: string[] }) => ({
    timestamp: 0,
    [tickers[0] as string]: '0.0000005',
  }),
  getRate: async (ticker: string) =>
    ticker === 'USD-BTC' ? '0.0000005' : '100000',
} as unknown as ExchangeRateService;

describe('exchange-rate domain', () => {
  it('getRate delegates to the service', async () => {
    const domain = createExchangeRateDomain(fakeService);
    expect(await domain.getRate('BTC-USD')).toBe('100000');
  });

  it('convert returns the same amount for same currency', async () => {
    const domain = createExchangeRateDomain(fakeService);
    const usd = new Money({
      amount: 100,
      currency: 'USD',
      unit: 'usd',
    }) as Money<Currency>;
    expect((await domain.convert({ amount: usd, to: 'USD' })).toString()).toBe(
      usd.toString(),
    );
  });

  it('convert uses getRate(`${from}-${to}`) + Money.convert', async () => {
    const domain = createExchangeRateDomain(fakeService);
    const usd = new Money({
      amount: 100,
      currency: 'USD',
      unit: 'usd',
    }) as Money<Currency>;
    const btc = await domain.convert({ amount: usd, to: 'BTC' });
    expect(btc.currency).toBe('BTC');
  });
});
