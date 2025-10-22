import { Clock, Star, UserCircle2 } from 'lucide-react';
import { useMemo } from 'react';
import type { LinksFunction } from 'react-router';
import agicashIcon192 from '~/assets/icon-192x192.png';
import blockandBeanCard from '~/assets/star-cards/blockandbean.agi.cash.png';
import compassCoffeeCard from '~/assets/star-cards/compass.agi.cash.png';
import fakeCard from '~/assets/star-cards/fake.agi.cash.png';
import fake2Card from '~/assets/star-cards/fake2.agi.cash.png';
import fake4Card from '~/assets/star-cards/fake4.agi.cash.png';
import pinkOwlCoffeeCard from '~/assets/star-cards/pinkowl.agi.cash.png';
import theShackCard from '~/assets/star-cards/shack.agi.cash.png';
import transparentCardBg from '~/assets/transparent-card.png';
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
import { useIsDesktop } from '~/hooks/use-is-desktop';
import { Money } from '~/lib/money';
import { LinkWithViewTransition } from '~/lib/transitions';

export const links: LinksFunction = () => [
  // This icon is used in the PWA dialog and prefetched here to avoid a flash while loading
  { rel: 'preload', href: agicashIcon192, as: 'image' },
  { rel: 'preload', href: transparentCardBg, as: 'image' },
  { rel: 'preload', href: whiteLogoSmall, as: 'image' },
  { rel: 'preload', href: compassCoffeeCard, as: 'image' },
  { rel: 'preload', href: pinkOwlCoffeeCard, as: 'image' },
  { rel: 'preload', href: theShackCard, as: 'image' },
  { rel: 'preload', href: fakeCard, as: 'image' },
  { rel: 'preload', href: fake2Card, as: 'image' },
  { rel: 'preload', href: fake4Card, as: 'image' },
  { rel: 'preload', href: blockandBeanCard, as: 'image' },
];

type DiscoverMint = {
  url: string;
  name: string;
  image: string;
  currency: 'BTC' | 'USD';
};

const DISCOVER_MINTS: DiscoverMint[] = [
  {
    url: 'https://blockandbean.agi.cash',
    name: 'Block and Bean',
    image: blockandBeanCard,
    currency: 'BTC',
  },
  {
    url: 'https://fake.agi.cash',
    name: 'Pubkey',
    image: fakeCard,
    currency: 'BTC',
  },
  // {
  //   url: 'https://fake2.agi.cash',
  //   name: 'NYTimes',
  //   image: fake2Card,
  //   currency: 'BTC',
  // },
  {
    url: 'https://fake4.agi.cash',
    name: 'Maple',
    image: fake4Card,
    currency: 'BTC',
  },
  {
    url: 'https://compass.agi.cash',
    name: 'Compass Coffee',
    image: compassCoffeeCard,
    currency: 'BTC',
  },
  {
    url: 'https://pinkowl.agi.cash',
    name: 'Pink Owl Coffee',
    image: pinkOwlCoffeeCard,
    currency: 'BTC',
  },
  {
    url: 'https://shack.agi.cash',
    name: 'The Shack',
    image: theShackCard,
    currency: 'BTC',
  },
];

export default function Index() {
  const hasTransactionsPendingAck = useHasTransactionsPendingAck();
  const isDesktop = useIsDesktop();

  const { data: starAccounts } = useAccounts({
    type: 'cashu',
    starAccountsOnly: true,
  });

  const sortedStarAccounts = useMemo(() => {
    return [...starAccounts].sort((a, b) => {
      const balanceA = getAccountBalance(a);
      const balanceB = getAccountBalance(b);
      return Money.compare(balanceB, balanceA);
    });
  }, [starAccounts]);

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
            <UserCircle2 className="text-muted-foreground" />
          </LinkWithViewTransition>
        </div>
      </header>

      {/* Fade gradient overlay - top (creates fade effect for scrolling content) */}
      <div className="-left-4 -right-4 pointer-events-none absolute top-0 z-10 h-16 bg-gradient-to-b from-background via-background/70 to-transparent" />

      <PageContent className="absolute inset-0 z-0 mx-auto flex flex-col items-center overflow-y-auto overflow-x-hidden pt-16 pb-44 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="w-full max-w-sm md:max-w-md">
          <HomePageCard />
        </div>

        {sortedStarAccounts.length > 0 && (
          <div className="mt-4 w-full max-w-sm md:max-w-2xl">
            <h2 className="mb-2 font-semibold text-lg">For You</h2>
            <div className="-mx-4 relative md:mx-0">
              <ScrollArea
                className="w-full"
                orientation="horizontal"
                hideScrollbar={!isDesktop}
              >
                <div className="flex w-max gap-2 px-4 md:px-0 md:pb-3">
                  {sortedStarAccounts.map((account) => (
                    <LinkWithViewTransition
                      key={account.id}
                      to={`/cards?accountId=${account.id}`}
                      transition="slideUp"
                      applyTo="newView"
                      className="w-40 shrink-0"
                    >
                      <WalletCard
                        account={account}
                        hideHeader={true}
                        hideFooter={true}
                      />
                      <span className="pl-2">
                        <MoneyWithConvertedAmount
                          variant="inline"
                          money={getAccountBalance(account)}
                        />
                      </span>
                    </LinkWithViewTransition>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}

        {discoverMints.length > 0 && (
          <div className="mt-4 w-full max-w-sm md:max-w-2xl">
            <h2 className="mb-2 font-semibold text-lg">Discover</h2>
            <div className="-mx-4 relative md:mx-0">
              <ScrollArea
                className="w-full"
                orientation="horizontal"
                hideScrollbar={!isDesktop}
              >
                <div className="flex w-max gap-2 px-4 md:px-0 md:pb-3">
                  {discoverMints.map((mint) => (
                    <LinkWithViewTransition
                      key={mint.url}
                      to={`/discover/add-mint?url=${encodeURIComponent(mint.url)}&currency=${mint.currency}&name=${encodeURIComponent(mint.name)}`}
                      transition="slideUp"
                      applyTo="newView"
                      className="flex w-40 shrink-0 flex-col gap-2"
                    >
                      <Card className="relative overflow-hidden rounded-3xl border-none">
                        <img
                          src={mint.image}
                          alt={mint.name}
                          className="block w-full"
                        />
                      </Card>
                    </LinkWithViewTransition>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
      </PageContent>

      <PageFooter className="absolute inset-x-0 bottom-0 z-20 mx-auto flex justify-center py-14">
        {/* Fade gradient overlay - bottom (creates fade effect for scrolling content) */}
        <div className="-left-4 -right-4 pointer-events-none absolute bottom-0 z-10 h-full bg-gradient-to-t from-background via-background to-transparent" />
        <div className="z-10 grid w-full max-w-sm grid-cols-2 gap-10 md:max-w-md">
          <LinkWithViewTransition
            to="/receive"
            transition="slideUp"
            applyTo="newView"
          >
            <Button className="w-full py-6 text-lg">Receive</Button>
          </LinkWithViewTransition>
          <LinkWithViewTransition
            to="/send"
            transition="slideUp"
            applyTo="newView"
          >
            <Button className="w-full py-6 text-lg">Send</Button>
          </LinkWithViewTransition>
        </div>
      </PageFooter>

      <InstallPwaPrompt />
    </Page>
  );
}

export function HomePageCard() {
  const defaultAccount = useDefaultAccount();

  return (
    <DefaultCurrencySwitcher>
      <button type="button" className="w-full focus-visible:outline-none">
        <CurrencyCard currency={defaultAccount.currency} showUsername={true} />
      </button>
    </DefaultCurrencySwitcher>
  );
}
