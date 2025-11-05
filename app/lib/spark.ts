import {
  type CurrencyAmount as SparkCurrencyAmount,
  CurrencyUnit as SparkCurrencyUnit,
} from '@buildonspark/spark-sdk/types';
import { type Currency, type CurrencyUnit, Money } from './money';

const sparkUnitToCurrencyUnit: {
  [K in SparkCurrencyUnit]: CurrencyUnit | null;
} = {
  [SparkCurrencyUnit.SATOSHI]: 'sat',
  [SparkCurrencyUnit.BITCOIN]: 'btc',
  [SparkCurrencyUnit.MILLISATOSHI]: 'msat',
  [SparkCurrencyUnit.NANOBITCOIN]: null,
  [SparkCurrencyUnit.MICROBITCOIN]: null,
  [SparkCurrencyUnit.MILLIBITCOIN]: null,
  [SparkCurrencyUnit.USD]: 'usd',
  [SparkCurrencyUnit.MXN]: null,
  [SparkCurrencyUnit.PHP]: null,
  [SparkCurrencyUnit.EUR]: null,
  [SparkCurrencyUnit.FUTURE_VALUE]: null,
};

const sparkUnitToCurrency: {
  [K in SparkCurrencyUnit]: Currency | null;
} = {
  [SparkCurrencyUnit.SATOSHI]: 'BTC',
  [SparkCurrencyUnit.BITCOIN]: 'BTC',
  [SparkCurrencyUnit.MILLISATOSHI]: 'BTC',
  [SparkCurrencyUnit.NANOBITCOIN]: null,
  [SparkCurrencyUnit.MICROBITCOIN]: null,
  [SparkCurrencyUnit.MILLIBITCOIN]: null,
  [SparkCurrencyUnit.USD]: 'USD',
  [SparkCurrencyUnit.MXN]: null,
  [SparkCurrencyUnit.PHP]: null,
  [SparkCurrencyUnit.EUR]: null,
  [SparkCurrencyUnit.FUTURE_VALUE]: null,
};

/**
 * Converts a Spark currency amount to a Money object
 * @param amount - Spark amount
 * @throws Error if the Spark currency is not supported by the Money object
 */
export const moneyFromSparkAmount = (amount: SparkCurrencyAmount): Money => {
  const currency = sparkUnitToCurrency[amount.originalUnit];
  const unit = sparkUnitToCurrencyUnit[amount.originalUnit];

  if (!currency || !unit) {
    throw new Error(`Unsupported Spark currency: ${amount.originalUnit}`);
  }

  return new Money({
    currency,
    amount: amount.originalValue,
    unit,
  });
};
