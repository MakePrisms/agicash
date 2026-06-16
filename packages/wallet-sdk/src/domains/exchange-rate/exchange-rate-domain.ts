import type { Currency, Money } from '@agicash/money';
import type { ExchangeRateDomain } from '../../domains';
import type { Ticker } from '../../types/exchange-rate';
import { ExchangeRateService } from './exchange-rate-service';

/** Build the exchange-rate domain over the multi-provider service. */
export function createExchangeRateDomain(
  service: ExchangeRateService = new ExchangeRateService(),
): ExchangeRateDomain {
  return {
    getRates({ tickers }) {
      return service.getRates({ tickers });
    },
    getRate(ticker: Ticker) {
      return service.getRate(ticker);
    },
    async convert({ amount, to }: { amount: Money; to: Currency }) {
      if (amount.currency === to) return amount;
      const rate = await service.getRate(`${amount.currency}-${to}`);
      return amount.convert(to, rate);
    },
  };
}
