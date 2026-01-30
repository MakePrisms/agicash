import { Clock, GiftIcon, UserCircle2 } from 'lucide-react';
import { useEffect } from 'react';
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
import { scheduleGiftCardPredecode } from '~/features/gift-cards/gift-card-predecode';
import { InstallPwaPrompt } from '~/features/pwa/install-pwa-prompt';
import { MoneyWithConvertedAmount } from '~/features/shared/money-with-converted-amount';
import { useHasTransactionsPendingAck } from '~/features/transactions/transaction-hooks';
import { useUser } from '~/features/user/user-hooks';
import { useFeatureFlag } from '~/lib/feature-flags';
import { LinkWithViewTransition } from '~/lib/transitions';

export const links: LinksFunction = () => [
  // This icon is used in the PWA dialog and prefetched here to avoid a flash while loading
  { rel: 'preload', href: agicashIcon192, as: 'image' },
];

export default function Index() {
  const balanceBTC = useBalance('BTC');
  const balanceUSD = useBalance('USD');
  const defaultBtcAccountId = useUser((user) => user.defaultBtcAccountId);
  const defaultUsdAccountId = useUser((user) => user.defaultUsdAccountId);
  const defaultCurrency = useDefaultAccount().currency;
  const hasTransactionsPendingAck = useHasTransactionsPendingAck();
  const giftCardsEnabled = useFeatureFlag('GIFT_CARDS');

  useEffect(() => {
    if (!giftCardsEnabled) {
      return;
    }

    scheduleGiftCardPredecode();
  }, [giftCardsEnabled]);

  return (
    <Page>
      <PageHeader className="z-10 px-4">
        <PageHeaderItem position="left">
          {giftCardsEnabled && (
            <LinkWithViewTransition
              to="/gift-cards"
              transition="slideRight"
              applyTo="newView"
            >
              <GiftIcon className="text-muted-foreground" />
            </LinkWithViewTransition>
          )}
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

      <PageContent className="absolute inset-0 mx-auto flex flex-col items-center justify-center gap-32">
        <div className="flex flex-col items-center gap-4">
          <MoneyWithConvertedAmount
            money={defaultCurrency === 'BTC' ? balanceBTC : balanceUSD}
          />
        </div>

        {defaultBtcAccountId && defaultUsdAccountId ? (
          <DefaultCurrencySwitcher />
        ) : (
          <div />
        )}

        <div className="grid w-72 grid-cols-2 gap-10">
          <LinkWithViewTransition
            to="/receive"
            transition="slideUp"
            applyTo="newView"
          >
            <Button className="w-full px-7 py-6 text-lg">Receive</Button>
          </LinkWithViewTransition>
          <LinkWithViewTransition
            to="/send"
            transition="slideUp"
            applyTo="newView"
          >
            <Button className="w-full px-7 py-6 text-lg">Send</Button>
          </LinkWithViewTransition>
        </div>
      </PageContent>

      <InstallPwaPrompt />
    </Page>
  );
}
