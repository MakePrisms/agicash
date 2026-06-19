import type { Sdk } from '@agicash/wallet-sdk';
import {
  type QueryClient,
  queryOptions,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useSdk } from '~/features/shared/use-sdk';
import type { Ticker } from '~/lib/exchange-rate';

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

export const exchangeRatesQueryOptions = (
  tickers: Ticker[],
  sdk: Promise<Sdk>,
) => {
  const normalizedTickers = getNormalizedTickers(tickers);
  return queryOptions({
    queryKey: ['exchangeRate', normalizedTickers],
    queryFn: async () =>
      (await sdk).exchangeRate.getRates({ tickers: normalizedTickers }),
  });
};

const exchangeRateQueryOptions = (ticker: Ticker, sdk: Promise<Sdk>) => {
  return exchangeRatesQueryOptions([ticker], sdk);
};

/**
 * Gets the exchange rate for the ticker.
 * The function will check the cache and if not found, it will fetch the rate.
 */
export const getExchangeRate = async (
  queryClient: QueryClient,
  ticker: Ticker,
  sdk: Promise<Sdk>,
) => {
  const rates = await queryClient.fetchQuery(
    exchangeRateQueryOptions(ticker, sdk),
  );
  return rates[ticker];
};

export const useExchangeRate = (ticker: Ticker) => {
  const sdk = useSdk();
  return useQuery({
    ...exchangeRateQueryOptions(ticker, sdk),
    select: (data) => data[ticker],
    refetchInterval: 15_000,
  });
};

export const useExchangeRates = (tickers: Ticker[]) => {
  const sdk = useSdk();
  return useQuery({
    ...exchangeRatesQueryOptions(tickers, sdk),
    refetchInterval: 15_000,
  });
};

/**
 * Returns a function that can be used to get the exchange rate for a given ticker.
 * The function will check the cache and if not found, it will fetch the rate.
 */
export const useGetExchangeRate = () => {
  const queryClient = useQueryClient();
  const sdk = useSdk();
  return (ticker: Ticker) => getExchangeRate(queryClient, ticker, sdk);
};
