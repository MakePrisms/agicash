export type Ticker = `${string}-${string}`;

export type GetRatesParams = {
  tickers: Ticker[];
  signal?: AbortSignal;
};

export interface ExchangeRateProvider {
  supportedTickers: Ticker[];
  getRates(params: GetRatesParams): Promise<Rates>;
}

export type Rates = {
  timestamp: number;
  [ticker: Ticker]: string;
};
