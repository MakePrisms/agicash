import {
  type QueryClient,
  queryOptions,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type Ticker, exchangeRateService } from '~/lib/exchange-rate';

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
  return queryOptions({
    queryKey: ['exchangeRate', normalizedTickers],
    queryFn: async ({ signal }) => {
      return exchangeRateService.getRates({
        tickers: normalizedTickers,
        signal,
      });
    },
  });
};

/**
 * Query options for fetching a single exchange rate.
 * Internally uses exchangeRatesQueryOptions to ensure cache sharing.
 * Note: This returns the full Rates object. Use with select or extract the ticker manually.
 */
const exchangeRateQueryOptions = (ticker: Ticker) => {
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

export const useExchangeRate = (ticker: Ticker) => {
  return useQuery({
    ...exchangeRateQueryOptions(ticker),
    select: (data) => data[ticker],
    refetchInterval: 15_000,
  });
};

export const useExchangeRates = (tickers: Ticker[]) => {
  return useQuery({
    ...exchangeRatesQueryOptions(tickers),
    refetchInterval: 15_000,
  });
};

/**
 * Returns a function that can be used to get the exchange rate for a given ticker.
 * The function will check the cache and if not found, it will fetch the rate.
 */
export const useGetExchangeRate = () => {
  const queryClient = useQueryClient();
  return (ticker: Ticker) => getExchangeRate(queryClient, ticker);
};
