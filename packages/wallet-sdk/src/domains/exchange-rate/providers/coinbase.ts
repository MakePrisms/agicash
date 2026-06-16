import Big from 'big.js';
import ky from 'ky';
import type {
  ExchangeRateProvider,
  GetRatesParams,
  Rates,
  Ticker,
} from './types';

type CoinbaseRatesResponse = {
  data: {
    rates: Record<string, string>;
  };
};

export class Coinbase implements ExchangeRateProvider {
  readonly supportedTickers: Ticker[] = [
    'BTC-USD',
    'USD-BTC',
    'BTC-EUR',
    'EUR-BTC',
    'BTC-GBP',
    'GBP-BTC',
    'BTC-CAD',
    'CAD-BTC',
    'BTC-CHF',
    'CHF-BTC',
    'BTC-AUD',
    'AUD-BTC',
    'BTC-JPY',
    'JPY-BTC',
  ];

  async getRates({ signal, tickers }: GetRatesParams): Promise<Rates> {
    this.validateTickers(tickers);
    const response = await ky.get<CoinbaseRatesResponse>(
      'https://api.coinbase.com/v2/exchange-rates?currency=BTC',
      { signal, timeout: 1_000 },
    );

    const data = await response.json();
    const btcRates = data.data.rates;

    const ratesMap = new Map<Ticker, string>();

    // all rates are in BTC
    const btc = 'BTC';

    for (const [currency, rate] of Object.entries(btcRates)) {
      const upperCurrency = currency.toUpperCase();
      const btcRate = rate.toString();

      ratesMap.set(`${btc}-${upperCurrency}`, btcRate);
      ratesMap.set(
        `${upperCurrency}-${btc}`,
        new Big(1).div(btcRate).toString(),
      );
    }

    const rates: Rates = {
      timestamp: Date.now(),
    };

    for (const ticker of tickers) {
      const rate = ratesMap.get(ticker);
      if (rate) {
        rates[ticker] = rate;
      }
    }

    return rates;
  }

  toString(): string {
    return this.constructor.name;
  }

  private validateTickers(tickers: Ticker[]): void {
    if (!tickers.length) {
      throw new Error('No tickers provided');
    }

    tickers.forEach((ticker) => {
      if (!this.supportedTickers.includes(ticker)) {
        throw new Error(`Unsupported ticker: ${ticker}`);
      }
    });
  }
}
