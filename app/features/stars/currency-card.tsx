import whiteLogoSmall from '~/assets/whitelogo-small.png';
import { MoneyDisplay } from '~/components/money-display';
import { Skeleton } from '~/components/ui/skeleton';
import { useExchangeRate } from '~/hooks/use-exchange-rate';
import type { Currency } from '~/lib/money/types';
import { useBalance } from '../accounts/account-hooks';
import { getDefaultUnit } from '../shared/currencies';
import { useUser } from '../user/user-hooks';
import { BaseCard } from './base-card';

type CurrencyCardProps = {
  currency: Currency;
  showUsername?: boolean;
  className?: string;
};

// TODO: this is largely duplicated in money-with-converted-amount.tsx, but it makes the placement different. We should refactor this to use the same component.

const defaultFiatCurrency = 'USD';

const getCurrencyToConvertTo = (
  currency: Currency,
  otherCurrency: Currency,
) => {
  // Only convert BTC to fiat, never fiat to BTC
  if (currency === 'BTC') {
    // If otherCurrency is fiat (not BTC), use it
    if (otherCurrency !== 'BTC') {
      return otherCurrency;
    }
    // Otherwise use default fiat
    return defaultFiatCurrency;
  }

  // For fiat currencies, don't convert
  return currency;
};

/**
 * A reusable currency card component that displays balance and converted amount.
 * Used for the homepage card and currency switcher.
 */
export function CurrencyCard({
  currency,
  showUsername = false,
  className,
}: CurrencyCardProps) {
  const username = useUser((user) => user.username);
  const defaultCurrency = useUser((user) => user.defaultCurrency);
  const balance = useBalance(currency);
  const conversionCurrency = getCurrencyToConvertTo(currency, defaultCurrency);
  const shouldShowConversion = currency !== conversionCurrency;
  const exchangeRateQuery = useExchangeRate(
    `${currency}-${conversionCurrency}`,
  );
  const convertedBalance =
    shouldShowConversion && exchangeRateQuery.data
      ? balance.convert(conversionCurrency, exchangeRateQuery.data)
      : null;

  return (
    <BaseCard className={className}>
      <div className="absolute inset-0 flex flex-col justify-between px-6 pt-6 pb-6">
        <div className="flex items-center gap-2">
          <img src={whiteLogoSmall} alt="Agicash Logo" className="h-7 w-7" />
          {showUsername && (
            <span className="text-sm text-white/90">{username}@agi.cash</span>
          )}
        </div>
        <div className="flex flex-col items-start gap-1">
          <MoneyDisplay
            money={balance}
            unit={getDefaultUnit(currency)}
            variant="default"
          />
          {shouldShowConversion && (
            <>
              {exchangeRateQuery.isLoading && <Skeleton className="h-5 w-20" />}
              {convertedBalance && (
                <MoneyDisplay money={convertedBalance} unit={'usd'} size="sm" />
              )}
            </>
          )}
        </div>
      </div>
    </BaseCard>
  );
}
