import type { QueryClient } from '@tanstack/query-core';
import { exchangeRateService } from './exchange-rate-service';
import type { Rates, Ticker } from './providers/types';

/**
 * Gets the normalized set of tickers to fetch.
 * Always fetches both directions for each ticker pair to maximize cache sharing.
 * For example, if 'BTC-USD' is requested, 'USD-BTC' will also be fetched.
 */
const getNormalizedTickers = (tickers: Ticker[]): Ticker[] => {
  const tickerSet = new Set(tickers);

  // For each ticker, add its reverse pair
  for (const ticker of tickers) {
    const [from, to] = ticker.split('-');
    if (from && to) {
      tickerSet.add(`${to}-${from}` as Ticker);
    }
  }

  return Array.from(tickerSet).sort();
};

/**
 * Query options for fetching multiple exchange rates.
 * The query key is normalized by sorting tickers to ensure cache sharing.
 * Always fetches both directions of each ticker pair (e.g., BTC-USD and USD-BTC).
 */
export const exchangeRatesQueryOptions = (tickers: Ticker[]) => {
  const normalizedTickers = getNormalizedTickers(tickers);
  return {
    queryKey: ['exchangeRate', normalizedTickers],
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Rates> => {
      return exchangeRateService.getRates({
        tickers: normalizedTickers,
        signal,
      });
    },
  };
};

/**
 * Query options for fetching a single exchange rate.
 * Internally uses exchangeRatesQueryOptions to ensure cache sharing.
 * Note: This returns the full Rates object. Use with select or extract the ticker manually.
 */
export const exchangeRateQueryOptions = (ticker: Ticker) => {
  return exchangeRatesQueryOptions([ticker]);
};

/**
 * Gets the exchange rate for the ticker.
 * The function will check the cache and if not found, it will fetch the rate.
 */
export const getExchangeRate = async (
  queryClient: QueryClient,
  ticker: Ticker,
) => {
  const rates = await queryClient.fetchQuery(exchangeRateQueryOptions(ticker));
  return rates[ticker];
};
