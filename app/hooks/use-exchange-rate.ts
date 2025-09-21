import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Ticker, exchangeRateService } from '~/lib/exchange-rate';

export const exchangeRateQueryOptions = (ticker: Ticker) =>
  queryOptions({
    queryKey: ['exchangeRate', ticker],
    queryFn: async ({ signal }) => {
      return exchangeRateService
        .getRates({
          tickers: [ticker],
          signal,
        })
        .then((rates) => rates[ticker]);
    },
  });

export const useExchangeRate = (ticker: Ticker) => {
  return useQuery({
    ...exchangeRateQueryOptions(ticker),
    refetchInterval: 15_000,
  });
};

export const useExchangeRates = (tickers: Ticker[]) => {
  return useQuery({
    queryKey: ['exchangeRate', tickers],
    queryFn: async ({ signal }) => {
      return exchangeRateService.getRates({
        tickers,
        signal,
      });
    },
    refetchInterval: 15_000,
  });
};

/**
 * Returns a function that can be used to get the exchange rate for a given ticker.
 * The function will check the cache and if not found, it will fetch the rate.
 */
export const useGetExchangeRate = () => {
  const queryClient = useQueryClient();

  return async (ticker: Ticker): Promise<string> => {
    return queryClient.fetchQuery(exchangeRateQueryOptions(ticker));
  };
};
