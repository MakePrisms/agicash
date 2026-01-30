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

const sizeConfig = {
  lg: {
    primary: 'lg',
    secondary: 'sm',
    minHeight: 'min-h-[116px]',
    skeletonClass: 'h-6 w-32',
  },
  md: {
    primary: 'md',
    secondary: 'xs',
    minHeight: 'min-h-[96px]',
    skeletonClass: 'h-5 w-26',
  },
} as const;

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
  size = 'lg',
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
  /**
   * Size of the display.
   */
  size?: 'lg' | 'md';
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

  const config = sizeConfig[size];

  return variant === 'default' ? (
    <div className={`flex flex-col items-center ${config.minHeight}`}>
      <MoneyDisplay money={money} unit={unit} size={config.primary} />
      {conversionData && (
        <>
          {conversionData.loading && (
            <Skeleton className={config.skeletonClass} />
          )}
          {conversionData.convertedMoney && (
            <MoneyDisplay
              money={conversionData.convertedMoney}
              unit={conversionData.unit}
              size={config.secondary}
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
