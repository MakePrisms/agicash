import { ArrowDownRight, ArrowUpRight, Clock, UserCircle2 } from 'lucide-react';
import type { LinksFunction } from 'react-router';
import agicashIcon192 from '~/assets/icon-192x192.png';
import { Page, PageContent, PageHeader } from '~/components/page';
import { Button } from '~/components/ui/button';
import {
  useAccounts,
  useBalance,
  useDefaultAccount,
} from '~/features/accounts/account-hooks';
import { DefaultCurrencySwitcher } from '~/features/accounts/default-currency-switcher';
import { InstallPwaPrompt } from '~/features/pwa/install-pwa-prompt';
import { MoneyWithConvertedAmount } from '~/features/shared/money-with-converted-amount';
import { useHasTransactionsPendingAck } from '~/features/transactions/transaction-hooks';
import { LinkWithViewTransition } from '~/lib/transitions';

export const links: LinksFunction = () => [
  // This icon is used in the PWA dialog and prefetched here to avoid a flash while loading
  { rel: 'preload', href: agicashIcon192, as: 'image' },
];

export default function Index() {
  const balanceBTC = useBalance('BTC');
  const balanceUSD = useBalance('USD');
  const defaultCurrency = useDefaultAccount().currency;
  const hasTransactionsPendingAck = useHasTransactionsPendingAck();
  const { data: accounts } = useAccounts();
  const hasUSDAccount = accounts.some((account) => account.currency === 'USD');
  const hasBTCAccount = accounts.some((account) => account.currency === 'BTC');

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
            <UserCircle2 className="text-muted-foreground" />
          </LinkWithViewTransition>
        </div>
      </PageHeader>

      <PageContent className="absolute inset-0 mx-auto flex flex-col items-center justify-center gap-32">
        <div className="flex flex-col items-center gap-4">
          <MoneyWithConvertedAmount
            money={defaultCurrency === 'BTC' ? balanceBTC : balanceUSD}
          />
        </div>

        {hasBTCAccount && hasUSDAccount ? <DefaultCurrencySwitcher /> : <div />}

        <div className="grid grid-cols-2 gap-10">
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
