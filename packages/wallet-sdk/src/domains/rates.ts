import type { Currency, Money } from '@agicash/money';
import { ExchangeRateService } from '../internal/rates/exchange-rate-service';
import type { Ticker } from '../internal/rates/providers/types';

/** A decimal exchange-rate string (e.g. "100000"), in source/target orientation
 * for the requested ticker — pass directly to `Money.convert(target, rate)`. */
export type Rate = string;

/**
 * Currency conversion via the SDK's internal exchange-rate providers
 * (MempoolSpace → Coingecko → Coinbase, with fallback). Self-contained: needs
 * no host-injected rate source.
 */
export class RatesDomain {
  constructor(
    private readonly exchangeRateService: ExchangeRateService = new ExchangeRateService(),
  ) {}

  /** The exchange rate for `ticker` (e.g. 'BTC-USD'). '1' for same-currency. */
  get(ticker: Ticker, signal?: AbortSignal): Promise<Rate> {
    return this.exchangeRateService.getRate(ticker, signal);
  }

  /** Convert `amount` into `to`, fetching the rate for `${amount.currency}-${to}`. */
  async convert<T extends Currency>(params: {
    amount: Money<T>;
    to: Currency;
    signal?: AbortSignal;
  }): Promise<Money> {
    const { amount, to, signal } = params;
    if (amount.currency === to) return amount as unknown as Money;
    const rate = await this.get(`${amount.currency}-${to}` as Ticker, signal);
    return amount.convert(to, rate);
  }
}
