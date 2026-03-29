import { Coinbase } from './providers/coinbase';
import { Coingecko } from './providers/coingecko';
import { MempoolSpace } from './providers/mempool-space';
import type {
  ExchangeRateProvider,
  GetRatesParams,
  Rates,
  Ticker,
} from './providers/types';

export class ExchangeRateService {
  private providers: ExchangeRateProvider[];

  constructor(providers?: ExchangeRateProvider[]) {
    // Keep order by priority
    this.providers = providers ?? [
      new MempoolSpace(),
      new Coingecko(),
      new Coinbase(),
    ];
  }
  async getRates({ tickers, signal }: GetRatesParams): Promise<Rates> {
    const rates: Rates = { timestamp: Date.now() };
    const remainingTickers: Ticker[] = [];

    for (const ticker of tickers) {
      const [to, from] = ticker.split('-');
      if (to === from) {
        rates[ticker] = '1';
      } else {
        remainingTickers.push(ticker);
      }
    }

    if (remainingTickers.length === 0) {
      return rates;
    }

    const providersForTickers = this.getProvidersForTickers(remainingTickers);
    if (!providersForTickers.length) {
      throw new Error(
        `No provider that supports all the specified tickers: ${remainingTickers}`,
      );
    }

    const errors: unknown[] = [];

    for (const provider of providersForTickers) {
      try {
        const providerRates = await provider.getRates({
          tickers: remainingTickers,
          signal,
        });
        return { ...rates, ...providerRates };
      } catch (e) {
        if (!signal?.aborted) {
          console.warn(`Error fetching rates from provider ${provider}`, {
            cause: e,
          });
        }
        errors.push(e);
      }
    }

    if (!signal?.aborted) {
      console.error('Failed to fetch rates for tickers', {
        cause: errors,
      });
    }
    const errorMessage = signal?.aborted
      ? 'Fetch rates aborted'
      : 'Failed to fetch rates';
    throw new Error(errorMessage);
  }

  /**
   * Gets a single rate for a specific ticker.
   * This is a convenience method for getting individual rates.
   */
  async getRate(ticker: Ticker, signal?: AbortSignal): Promise<string> {
    const rates = await this.getRates({ tickers: [ticker], signal });
    return rates[ticker];
  }

  private getProvidersForTickers(tickers: Ticker[]): ExchangeRateProvider[] {
    const matchingProviders: ExchangeRateProvider[] = [];
    for (const provider of this.providers) {
      // check if provider.supportedTickers contains all tickers
      if (
        tickers.every((ticker) => provider.supportedTickers.includes(ticker))
      ) {
        matchingProviders.push(provider);
      }
    }
    return matchingProviders;
  }
}

export const exchangeRateService = new ExchangeRateService();
