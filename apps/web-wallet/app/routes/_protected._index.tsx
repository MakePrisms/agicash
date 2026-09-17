import { Clock, GiftIcon, Scan, UserCircle2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LinksFunction } from 'react-router';
import agicashIcon192 from '~/assets/icon-192x192.png';
import {
  Page,
  PageContent,
  PageHeader,
  PageHeaderItem,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import {
  useBalance,
  useDefaultAccount,
} from '~/features/accounts/account-hooks';
import { DefaultCurrencySwitcher } from '~/features/accounts/default-currency-switcher';
import { CASH_APP_LOGO_URL } from '~/features/buy/cash-app';
import { InstallPwaPrompt } from '~/features/pwa/install-pwa-prompt';
import { useFeatureFlag } from '~/features/shared/feature-flags';
import { MoneyWithConvertedAmount } from '~/features/shared/money-with-converted-amount';
import { SEND_RECEIVE_DISABLED_MESSAGE } from '~/features/shared/wallet-operations';
import { useHasTransactionsPendingAck } from '~/features/transactions/transaction-hooks';
import { useUser } from '~/features/user/user-hooks';
import useIsPwa from '~/hooks/use-is-pwa';
import { LinkWithViewTransition } from '~/lib/transitions';
import { cn } from '~/lib/utils';

export const links: LinksFunction = () => [
  // This icon is used in the PWA dialog and prefetched here to avoid a flash while loading
  { rel: 'prefetch', href: agicashIcon192, as: 'image' },
  // This logo is used on the buy screen and prefetched here to avoid a flash while loading
  { rel: 'prefetch', href: CASH_APP_LOGO_URL, as: 'image' },
];

type ActionButtonProps = {
  to: string;
  variant?: 'default' | 'secondary';
  disabled?: boolean;
  children: ReactNode;
};

function ActionButton({
  to,
  variant,
  disabled = false,
  children,
}: ActionButtonProps) {
  const button = (
    <Button
      variant={variant}
      className="w-full px-7 py-6 text-lg"
      disabled={disabled}
    >
      {children}
    </Button>
  );

  if (disabled) {
    return button;
  }

  return (
    <LinkWithViewTransition to={to} transition="slideUp" applyTo="newView">
      {button}
    </LinkWithViewTransition>
  );
}

export default function Index() {
  const balanceBTC = useBalance('BTC');
  const balanceUSD = useBalance('USD');
  const defaultBtcAccountId = useUser((user) => user.defaultBtcAccountId);
  const defaultUsdAccountId = useUser((user) => user.defaultUsdAccountId);
  const defaultCurrency = useDefaultAccount().currency;
  const hasTransactionsPendingAck = useHasTransactionsPendingAck();
  const isPwa = useIsPwa();
  const walletOperationsEnabled = useFeatureFlag('WALLET_OPERATIONS');

  return (
    <Page>
      <PageHeader className="z-10 px-4">
        <PageHeaderItem position="left" className="flex gap-6">
          <LinkWithViewTransition
            to="/gift-cards"
            transition="slideRight"
            applyTo="newView"
          >
            <GiftIcon className="text-muted-foreground" />
          </LinkWithViewTransition>
          <LinkWithViewTransition
            to="/scan"
            transition="slideUp"
            applyTo="newView"
          >
            <Scan className="text-muted-foreground" />
          </LinkWithViewTransition>
        </PageHeaderItem>

        <PageHeaderItem position="right" className="flex gap-6">
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
        </PageHeaderItem>
      </PageHeader>

      <PageContent className="mx-auto items-center justify-between pt-20 sm:justify-center sm:gap-32 sm:py-0">
        <div className={cn(isPwa && 'pt-[30px]')}>
          <MoneyWithConvertedAmount
            money={defaultCurrency === 'BTC' ? balanceBTC : balanceUSD}
          />
        </div>

        {defaultBtcAccountId && defaultUsdAccountId ? (
          <DefaultCurrencySwitcher />
        ) : (
          <div />
        )}

        <div className={cn('flex w-72 flex-col gap-4', isPwa && 'pb-20')}>
          {!walletOperationsEnabled && (
            <p className="text-center text-muted-foreground text-sm">
              {SEND_RECEIVE_DISABLED_MESSAGE}
            </p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <ActionButton
              to="/receive"
              variant="secondary"
              disabled={!walletOperationsEnabled}
            >
              Receive
            </ActionButton>
            <ActionButton to="/buy" variant="secondary">
              Buy
            </ActionButton>
          </div>
          <ActionButton to="/send" disabled={!walletOperationsEnabled}>
            Send
          </ActionButton>
        </div>
      </PageContent>

      <InstallPwaPrompt />
    </Page>
  );
}
