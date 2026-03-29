import type { Currency, CurrencyUnit } from '../../lib/money';

const currencyToDefaultUnit: {
  [K in Currency]: CurrencyUnit<K>;
} = {
  BTC: 'sat',
  USD: 'usd',
};

export const getDefaultUnit = (currency: Currency) => {
  return currencyToDefaultUnit[currency];
};
