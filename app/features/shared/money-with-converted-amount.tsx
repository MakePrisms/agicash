import { MoneyDisplay } from '~/components/money-display';
import { Skeleton } from '~/components/ui/skeleton';
import { useExchangeRate } from '~/hooks/use-exchange-rate';
import type { Currency, Money } from '~/lib/money';
import { getDefaultUnit } from './currencies';

const defaultFiatCurrency = 'USD';

const getCurrencyToConvertTo = (money: Money, otherCurrency: Currency) => {
  if (money.currency !== otherCurrency) {
    return otherCurrency;
  }

  if (money.currency === 'BTC') {
    return defaultFiatCurrency;
  }

  if (money.currency !== defaultFiatCurrency) {
    return 'BTC';
  }

  return money.currency;
};

/**
 * Displays money amount and its amount converted to the other currency.
 * If other currency is not provided, it will default to USD if money currency is USD, and default to BTC otherwise.
 * If money currency and other currency are equal (after default logic is applied) and value is:
 *   a) USD - it will not display the converted amount.
 *   b) BTC - it will display the converted amount in USD.
 *   c) other - it will display the converted amount in BTC.
 */
export const MoneyWithConvertedAmount = ({
  money,
  otherCurrency = money.currency === defaultFiatCurrency
    ? defaultFiatCurrency
    : 'BTC',
  variant = 'default',
}: {
  /**
   * Money amount to display.
   */
  money: Money;
  /**
   * Currency to convert to. If not provided, it defaults to USD if money currency is USD, and BTC otherwise.
   */
  otherCurrency?: Currency;
  /**
   * Variant to display the money amount and converted amount.
   */
  variant?: 'default' | 'inline';
}) => {
  const currencyToConvertTo = getCurrencyToConvertTo(money, otherCurrency);
  const exchangeRateQuery = useExchangeRate(
    `${money.currency}-${currencyToConvertTo}`,
  );

  const unit = getDefaultUnit(money.currency);

  const conversionData =
    money.currency !== currencyToConvertTo
      ? {
          rate: exchangeRateQuery.data,
          loading: exchangeRateQuery.isLoading,
          unit: getDefaultUnit(currencyToConvertTo),
          convertedMoney: exchangeRateQuery.data
            ? money.convert(currencyToConvertTo, exchangeRateQuery.data)
            : null,
        }
      : null;

  return variant === 'default' ? (
    <div className="flex min-h-[116px] flex-col items-center">
      <MoneyDisplay money={money} unit={unit} />
      {conversionData && (
        <>
          {conversionData.loading && <Skeleton className="h-6 w-32" />}
          {conversionData.convertedMoney && (
            <MoneyDisplay
              money={conversionData.convertedMoney}
              unit={conversionData.unit}
              size="sm"
              variant="muted"
            />
          )}
        </>
      )}
    </div>
  ) : (
    <span className="text-muted-foreground text-sm">
      {money.toLocaleString({ unit })}
      {conversionData && (
        <>
          {conversionData.loading && (
            <Skeleton className="ml-1 inline-block h-4 w-10" />
          )}
          {conversionData.convertedMoney &&
            ` (~${conversionData.convertedMoney.toLocaleString({
              unit: conversionData.unit,
            })})`}
        </>
      )}
    </span>
  );
};
