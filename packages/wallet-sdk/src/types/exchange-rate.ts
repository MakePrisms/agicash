/**
 * Exchange-rate types — §6 contract delta (multi-provider rate surface).
 *
 * Lifted from `app/lib/exchange-rate/providers/types.ts`. A `Ticker` is a
 * `${from}-${to}` currency pair (e.g. `'BTC-USD'`); `Rates` maps each requested
 * ticker to its rate string at a `timestamp`.
 */

/** A currency pair, formatted `${from}-${to}` (e.g. `'BTC-USD'`, `'USD-BTC'`). */
export type Ticker = `${string}-${string}`;

/** A set of fetched rates: each ticker → its rate string, plus the fetch `timestamp`. */
export type Rates = {
  timestamp: number;
  [ticker: Ticker]: string;
};
