import {
  type Ticker,
  exchangeRateQueryOptions,
  exchangeRatesQueryOptions,
  getExchangeRate,
} from '@agicash/wallet-sdk/exchange-rate';
import { useQuery, useQueryClient } from '@tanstack/react-query';

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
