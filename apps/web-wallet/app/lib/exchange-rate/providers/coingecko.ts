import Big from 'big.js';
import ky from 'ky';
import type {
  ExchangeRateProvider,
  GetRatesParams,
  Rates,
  Ticker,
} from './types';

type CoingeckoRatesResponse = {
  bitcoin: Record<string, string>;
};

export class Coingecko implements ExchangeRateProvider {
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

  async getRates({ tickers, signal }: GetRatesParams): Promise<Rates> {
    this.validateTickers(tickers);

    const response = await ky.get<CoingeckoRatesResponse>(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur,gbp,cad,chf,aud,jpy',
      { signal },
    );

    const data = await response.json();
    const bitcoinRates = data.bitcoin;

    const ratesMap = new Map<Ticker, string>();

    // all rates are in BTC
    const btc = 'BTC';

    for (const [currency, rate] of Object.entries(bitcoinRates)) {
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
