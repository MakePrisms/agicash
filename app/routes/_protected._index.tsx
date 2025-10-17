import { ArrowDownRight, ArrowUpRight, Clock, Cog, Star } from 'lucide-react';
import { useMemo } from 'react';
import type { LinksFunction } from 'react-router';
import currencyCardBg from '~/assets/currency-card-bg.png';
import agicashIcon192 from '~/assets/icon-192x192.png';
import blockandBeanCard from '~/assets/star-cards/blockandbean.agi.cash.png';
import fakeCard from '~/assets/star-cards/fake.agi.cash.png';
import fake2Card from '~/assets/star-cards/fake2.agi.cash.png';
import fake4Card from '~/assets/star-cards/fake4.agi.cash.png';
import whiteLogoSmall from '~/assets/whitelogo-small.png';
import { Page, PageContent, PageFooter } from '~/components/page';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { ScrollArea } from '~/components/ui/scroll-area';
import { getAccountBalance } from '~/features/accounts/account';
import {
  useAccounts,
  useDefaultAccount,
} from '~/features/accounts/account-hooks';
import { DefaultCurrencySwitcher } from '~/features/accounts/default-currency-switcher';
import { InstallPwaPrompt } from '~/features/pwa/install-pwa-prompt';
import { MoneyWithConvertedAmount } from '~/features/shared/money-with-converted-amount';
import { CurrencyCard } from '~/features/stars/currency-card';
import { WalletCard } from '~/features/stars/wallet-card';
import { useHasTransactionsPendingAck } from '~/features/transactions/transaction-hooks';
import { LinkWithViewTransition } from '~/lib/transitions';

export const links: LinksFunction = () => [
  // This icon is used in the PWA dialog and prefetched here to avoid a flash while loading
  { rel: 'preload', href: agicashIcon192, as: 'image' },
  { rel: 'preload', href: currencyCardBg, as: 'image' },
  { rel: 'preload', href: whiteLogoSmall, as: 'image' },
];

type DiscoverMint = {
  url: string;
  name: string;
  image: string;
};

const DISCOVER_MINTS: DiscoverMint[] = [
  {
    url: 'https://blockandbean.agi.cash',
    name: 'Block and Bean',
    image: blockandBeanCard,
  },
  {
    url: 'https://fake.agi.cash',
    name: 'Fake',
    image: fakeCard,
  },
  {
    url: 'https://fake2.agi.cash',
    name: 'Fake2',
    image: fake2Card,
  },
  {
    url: 'https://fake4.agi.cash',
    name: 'Fake4',
    image: fake4Card,
  },
];

export default function Index() {
  const hasTransactionsPendingAck = useHasTransactionsPendingAck();

  const { data: starAccounts } = useAccounts({
    type: 'cashu',
    starAccountsOnly: true,
  });

  const discoverMints = useMemo(() => {
    const existingMintUrls = new Set(
      starAccounts.map((account) => account.mintUrl),
    );
    return DISCOVER_MINTS.filter((mint) => !existingMintUrls.has(mint.url));
  }, [starAccounts]);

  return (
    <Page className="relative overflow-hidden">
      {/* Fixed header layer - positioned above scrolling content */}
      <header className="absolute inset-x-0 top-0 z-20 flex w-full items-center justify-between px-4 pt-4 pb-4">
        <LinkWithViewTransition
          to="/cards"
          transition="slideRight"
          applyTo="newView"
        >
          <Star className="text-muted-foreground" />
        </LinkWithViewTransition>

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
      </header>

      {/* Fade gradient overlay - top (creates fade effect for scrolling content) */}
      <div className="-left-4 -right-4 pointer-events-none absolute top-0 z-10 h-16 bg-gradient-to-b from-background via-background/70 to-transparent" />

      <PageContent className="absolute inset-0 z-0 flex flex-col overflow-y-auto overflow-x-hidden pt-16 pb-44 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="w-full max-w-xs">
          <HomePageCard />
        </div>

        <h2 className="mt-4 mb-2 font-semibold text-lg">For You</h2>
        <div className="-mx-4 relative">
          <ScrollArea className="w-full" orientation="horizontal" hideScrollbar>
            <div className="flex w-max gap-2 px-4">
              {starAccounts.map((account) => (
                <LinkWithViewTransition
                  key={account.id}
                  to={`/cards?accountId=${account.id}`}
                  transition="slideUp"
                  applyTo="newView"
                  className="w-[40vw] shrink-0"
                >
                  <WalletCard
                    account={account}
                    hideHeader={true}
                    hideFooter={true}
                  />
                  <MoneyWithConvertedAmount
                    variant="inline"
                    money={getAccountBalance(account)}
                  />
                </LinkWithViewTransition>
              ))}
            </div>
          </ScrollArea>
        </div>

        {discoverMints.length > 0 && (
          <>
            <h2 className="mt-4 mb-2 font-semibold text-lg">Discover</h2>
            <div className="grid grid-cols-2 gap-4">
              {discoverMints.map((mint) => (
                <div key={mint.url} className="flex flex-col gap-2">
                  <Card className="relative overflow-hidden rounded-3xl border-none">
                    <img
                      src={mint.image}
                      alt={mint.name}
                      className="block w-full"
                    />
                  </Card>
                  <span className="text-sm">{mint.name}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </PageContent>

      {/* Fade gradient overlay - bottom (creates fade effect for scrolling content) */}

      <PageFooter className="absolute inset-x-0 bottom-0 z-20 py-20">
        <div className="-left-4 -right-4 pointer-events-none absolute bottom-0 z-10 h-full bg-gradient-to-t from-background via-background/90 to-transparent" />
        <div className="z-10 grid w-full grid-cols-2 gap-10">
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
      </PageFooter>

      <InstallPwaPrompt />
    </Page>
  );
}

export function HomePageCard() {
  const defaultAccount = useDefaultAccount();
  const currencies: Array<'BTC' | 'USD'> = ['BTC', 'USD'];

  return (
    <DefaultCurrencySwitcher>
      <DefaultCurrencySwitcher.Trigger>
        <button type="button" className="w-full">
          <CurrencyCard
            currency={defaultAccount.currency}
            showUsername={true}
          />
        </button>
      </DefaultCurrencySwitcher.Trigger>
      <DefaultCurrencySwitcher.Content>
        {currencies.map((currency) => (
          <DefaultCurrencySwitcher.CurrencyCardWrapper
            key={currency}
            currency={currency}
          >
            <CurrencyCard
              currency={currency}
              showUsername={false}
              className={currency === 'BTC' ? 'btc' : 'usd'}
            />
          </DefaultCurrencySwitcher.CurrencyCardWrapper>
        ))}
      </DefaultCurrencySwitcher.Content>
    </DefaultCurrencySwitcher>
  );
}
