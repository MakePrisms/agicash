import { describe, expect, test } from 'bun:test';
import { ExchangeRateService } from './exchange-rate-service';

import type {
  ExchangeRateProvider,
  GetRatesParams,
  Rates,
  Ticker,
} from './providers/types';

class MockExchangeRateProvider implements ExchangeRateProvider {
  readonly supportedTickers: Ticker[] = ['BTC-USD', 'USD-BTC'];
  private shouldFail = false;

  constructor(shouldFail = false) {
    this.shouldFail = shouldFail;
  }

  async getRates(_params: GetRatesParams): Promise<Rates> {
    if (this.shouldFail) {
      throw new Error('Failed to fetch rates');
    }

    return {
      timestamp: Date.now(),
      'BTC-USD': '100000',
      'USD-BTC': '0.00001',
    };
  }
}

class MockExchangeRateProviderEUR implements ExchangeRateProvider {
  readonly supportedTickers: Ticker[] = ['EUR-BTC'];

  async getRates(params: GetRatesParams): Promise<Rates> {
    return this.fetchRates(params);
  }

  protected async fetchRates(_params: GetRatesParams): Promise<Rates> {
    return {
      timestamp: Date.now(),
      'EUR-BTC': '0.00002',
    };
  }
}

describe('ExchangeRateService', () => {
  test('uses provided exchange rate providers', async () => {
    const mockProvider = new MockExchangeRateProvider();
    const service = new ExchangeRateService([mockProvider]);

    const rates = await service.getRates({
      tickers: ['BTC-USD', 'USD-BTC'],
    });

    expect(rates['BTC-USD']).toBe('100000');
    expect(rates['USD-BTC']).toBe('0.00001');
  });

  test('falls back to next provider on failure', async () => {
    const failingProvider = new MockExchangeRateProvider(true);
    const workingProvider = new MockExchangeRateProvider();
    const service = new ExchangeRateService([failingProvider, workingProvider]);

    const rates = await service.getRates({
      tickers: ['BTC-USD'],
    });

    expect(rates['BTC-USD']).toBe('100000');
  });

  test('throws error when no provider supports requested tickers', async () => {
    const mockProvider = new MockExchangeRateProvider();
    const service = new ExchangeRateService([mockProvider]);

    await expect(
      service.getRates({
        tickers: ['JPY-BTC'],
      }),
    ).rejects.toThrow('No provider that supports all the specified tickers');
  });

  test('finds provider that supports requested tickers', async () => {
    const btcProvider = new MockExchangeRateProvider();
    const eurProvider = new MockExchangeRateProviderEUR();
    const service = new ExchangeRateService([btcProvider, eurProvider]);

    const rates = await service.getRates({
      tickers: ['EUR-BTC'],
    });

    expect(rates['EUR-BTC']).toBe('0.00002');
  });

  test('throws error when all providers fail', async () => {
    const failingProvider1 = new MockExchangeRateProvider(true);
    const failingProvider2 = new MockExchangeRateProvider(true);
    const service = new ExchangeRateService([
      failingProvider1,
      failingProvider2,
    ]);

    expect(
      service.getRates({
        tickers: ['BTC-USD'],
      }),
    ).rejects.toThrow('Failed to fetch rates');
  });
});
