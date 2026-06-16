import type { Rates, Ticker } from '../../../types/exchange-rate';

export type { Ticker, Rates } from '../../../types/exchange-rate';

export type GetRatesParams = {
  tickers: Ticker[];
  signal?: AbortSignal;
};

export interface ExchangeRateProvider {
  supportedTickers: Ticker[];
  getRates(params: GetRatesParams): Promise<Rates>;
}
