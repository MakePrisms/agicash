import currencyCardBg from '~/assets/currency-card-bg.png';
import whiteLogoSmall from '~/assets/whitelogo-small.png';
import { MoneyDisplay } from '~/components/money-display';
import { Card, CardContent } from '~/components/ui/card';
import { Skeleton } from '~/components/ui/skeleton';
import { useExchangeRate } from '~/hooks/use-exchange-rate';
import type { Currency } from '~/lib/money/types';
import { cn } from '~/lib/utils';
import { useBalance } from '../accounts/account-hooks';
import { getDefaultUnit } from '../shared/currencies';
import { useUser } from '../user/user-hooks';
import { CARD_ASPECT_RATIO } from './animation-constants';

type CurrencyCardProps = {
  currency: Currency;
  showUsername?: boolean;
  className?: string;
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
  const balance = useBalance(currency);
  const conversionCurrency = currency === 'BTC' ? 'USD' : 'BTC';
  const exchangeRateQuery = useExchangeRate(
    `${currency}-${conversionCurrency}`,
  );
  const convertedBalance = exchangeRateQuery.data
    ? balance.convert(conversionCurrency, exchangeRateQuery.data)
    : null;

  return (
    <Card
      className={cn(
        'relative w-full overflow-hidden rounded-3xl border-none',
        className,
      )}
      style={{
        aspectRatio: CARD_ASPECT_RATIO.toString(),
      }}
    >
      <img
        src={currencyCardBg}
        alt="Wallet card background"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <CardContent className="absolute inset-0 flex flex-col gap-3 px-6 pt-6 pb-6">
        {showUsername && (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-2 font-mono text-sm text-white/90">
              <img
                src={whiteLogoSmall}
                alt="Agicash Logo"
                className="h-6 w-6"
              />{' '}
              {username}@agi.cash
            </span>
          </div>
        )}
        <div className="flex flex-col items-start gap-1">
          <MoneyDisplay
            money={balance}
            unit={getDefaultUnit(currency)}
            variant="default"
          />
          {exchangeRateQuery.isLoading && <Skeleton className="h-5 w-20" />}
          {convertedBalance && (
            <div className="text-sm text-white/80">
              {convertedBalance.toLocaleString({
                unit: getDefaultUnit(conversionCurrency),
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
