import type { Currency, CurrencyUnit } from '@agicash/lib';

const currencyToDefaultUnit: {
  [K in Currency]: CurrencyUnit<K>;
} = {
  BTC: 'sat',
  USD: 'usd',
};

export const getDefaultUnit = (currency: Currency) => {
  return currencyToDefaultUnit[currency];
};
