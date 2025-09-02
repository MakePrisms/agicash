import {
  ArrowDownRight,
  ArrowUpRight,
  ChartSpline,
  Clock,
  Cog,
} from 'lucide-react';
import { useState } from 'react';
import type { LinksFunction } from 'react-router';
import agicashIcon192 from '~/assets/icon-192x192.png';
import { Page, PageContent, PageHeader } from '~/components/page';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import {
  useBalance,
  useDefaultAccount,
} from '~/features/accounts/account-hooks';
import { DefaultCurrencySwitcher } from '~/features/accounts/default-currency-switcher';
import { InstallPwaPrompt } from '~/features/pwa/install-pwa-prompt';
import { MoneyWithConvertedAmount } from '~/features/shared/money-with-converted-amount';
import { useHasTransactionsPendingAck } from '~/features/transactions/transaction-hooks';
import { useExchangeRates } from '~/hooks/use-exchange-rate';
import type { Ticker } from '~/lib/exchange-rate';
import { Money } from '~/lib/money';
import { LinkWithViewTransition } from '~/lib/transitions';

export const links: LinksFunction = () => [
  // This icon is used in the PWA dialog and prefetched here to avoid a flash while loading
  { rel: 'preload', href: agicashIcon192, as: 'image' },
];

const Price = () => {
  const [showSatsPerDollar, setShowSatsPerDollar] = useState(false);
  const { data: rates } = useExchangeRates(
    (['BTC-USD', 'USD-BTC'] as Ticker[]).sort(),
  );

  if (!rates) return <Skeleton className="h-[24px] w-[81px]" />;

  const moneyString = showSatsPerDollar
    ? new Money({ amount: 1, currency: 'USD' })
        .convert('BTC', rates['USD-BTC'])
        .toLocaleString({ unit: 'sat' })
    : new Money({ amount: rates['BTC-USD'], currency: 'USD' })
        .toLocaleString({ unit: 'usd' })
        .slice(0, -3);

  return (
    <button
      type="button"
      onClick={() => setShowSatsPerDollar(!showSatsPerDollar)}
      className="flex items-center gap-2"
    >
      {showSatsPerDollar && <ChartSpline size={16} className="animate-pulse" />}
      <span className="font-medium">{moneyString}</span>
      {!showSatsPerDollar && (
        <ChartSpline size={16} className="animate-pulse" />
      )}
    </button>
  );
};

export default function Index() {
  const balanceBTC = useBalance('BTC');
  const balanceUSD = useBalance('USD');
  const defaultCurrency = useDefaultAccount().currency;
  const hasTransactionsPendingAck = useHasTransactionsPendingAck();

  return (
    <Page>
      <PageHeader className="z-10 flex w-full items-center justify-end gap-4 pr-4">
        <div className="flex items-center gap-6">
          <LinkWithViewTransition
            to="/transactions"
            transition="slideLeft"
            applyTo="newView"
            className="relative"
          >
            <Clock className="text-muted-foreground" />
            {hasTransactionsPendingAck && (
              <div className="-right-0 -top-0 absolute h-[8px] w-[8px] rounded-full bg-green-500" />
            )}
          </LinkWithViewTransition>
          <LinkWithViewTransition
            to="/settings"
            transition="slideLeft"
            applyTo="newView"
          >
            <Cog className="text-muted-foreground" />
          </LinkWithViewTransition>
        </div>
      </PageHeader>

      <PageContent className="absolute inset-0 mx-auto flex flex-col items-center justify-center gap-24">
        <div className="flex h-[156px] flex-col items-center gap-4">
          <MoneyWithConvertedAmount
            money={defaultCurrency === 'BTC' ? balanceBTC : balanceUSD}
          />
          {defaultCurrency === 'BTC' && <Price />}
        </div>

        <DefaultCurrencySwitcher />

        <div className="grid grid-cols-2 gap-10 pt-3">
          <LinkWithViewTransition
            to="/receive"
            transition="slideUp"
            applyTo="newView"
          >
            <Button className="w-full py-6 text-lg">
              Receive <ArrowDownRight />
            </Button>
          </LinkWithViewTransition>
          <LinkWithViewTransition
            to="/send"
            transition="slideUp"
            applyTo="newView"
          >
            <Button className="w-full py-6 text-lg">
              Send <ArrowUpRight />
            </Button>
          </LinkWithViewTransition>
        </div>
      </PageContent>

      <InstallPwaPrompt />
    </Page>
  );
}
