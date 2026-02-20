import Big from 'big.js';
import ky from 'ky';
import type {
  ExchangeRateProvider,
  GetRatesParams,
  Rates,
  Ticker,
} from './types';

type MempoolSpaceRatesResponse = {
  time: number;
  [currency: string]: number;
};

export class MempoolSpace implements ExchangeRateProvider {
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

    const response = await ky.get<MempoolSpaceRatesResponse>(
      'https://mempool.space/api/v1/prices',
      { signal, timeout: 1_000 },
    );

    const data = await response.json();
    const { time, ...currencies } = data;

    const ratesMap = new Map<Ticker, string>();
    // all rates are in BTC
    const btc = 'BTC';

    for (const [currency, rate] of Object.entries(currencies)) {
      const btcRate = rate.toString();

      ratesMap.set(`${btc}-${currency}`, btcRate);
      ratesMap.set(`${currency}-${btc}`, new Big(1).div(btcRate).toString());
    }

    const rates: Rates = {
      timestamp: time * 1000,
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
