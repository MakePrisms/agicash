import { X } from 'lucide-react';
import { useNavigate, useViewTransitionState } from 'react-router';

import {
  Page,
  PageContent,
  PageHeader,
  PageHeaderItem,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import { getAccountBalance } from '~/features/accounts/account';
import { useAccounts } from '~/features/accounts/account-hooks';
import { GiftCardItem } from '~/features/gift-cards/gift-card-item';
import { getGiftCardImageByUrl } from '~/features/gift-cards/use-discover-cards';
import { MoneyWithConvertedAmount } from '~/features/shared/money-with-converted-amount';
import { TransactionList } from '~/features/transactions/transaction-list';
import { LinkWithViewTransition } from '~/lib/transitions';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  VERTICAL_CARD_OFFSET_IN_STACK,
} from './card-stack-constants';

type GiftCardDetailsProps = {
  cardId: string;
};

export default function GiftCardDetails({ cardId }: GiftCardDetailsProps) {
  const navigate = useNavigate();
  const isTransitioning = useViewTransitionState('/gift-cards');

  const { data: giftCardAccounts } = useAccounts({
    purpose: 'gift-card',
  });

  const card = giftCardAccounts.find((c) => c.id === cardId);
  const selectedIndex = giftCardAccounts.findIndex((c) => c.id === cardId);

  const handleBack = () => {
    navigate('/gift-cards', { viewTransition: true });
  };

  if (!card) {
    return (
      <Page className="flex items-center justify-center">
        <p className="text-muted-foreground">Card not found</p>
      </Page>
    );
  }

  const balance = getAccountBalance(card);

  return (
    <Page className="px-0 pb-0">
      <PageHeader className="absolute inset-x-0 top-0 z-[60] flex w-full items-center justify-between px-4 pt-4 pb-4">
        <PageHeaderItem position="left">
          <button type="button" onClick={handleBack} aria-label="Close">
            <X />
          </button>
        </PageHeaderItem>
      </PageHeader>

      <PageContent className="scrollbar-none relative min-h-0 gap-0 overflow-y-auto pt-16 pb-0">
        {/* Card area - split-stack positioning */}
        <div className="w-full px-4">
          <div
            className="relative mx-auto w-full"
            style={{
              minHeight: CARD_HEIGHT,
              maxWidth: CARD_WIDTH,
            }}
          >
            {/* We render all gift cards for view transitions. */}
            {giftCardAccounts.map((account, index) => {
              const isSelected = account.id === card.id;
              const zIndex = index + 1;
              const isAtOrBelowSelected = index <= selectedIndex;

              if (isAtOrBelowSelected) {
                const item = (
                  <GiftCardItem
                    account={account}
                    image={getGiftCardImageByUrl(account.mintUrl)}
                    className="w-full max-w-none"
                    hideOverlayContent={isSelected}
                  />
                );

                // Cards at or below selected: transition to the top
                return (
                  <div
                    key={account.id}
                    className={
                      isSelected ? 'relative' : 'absolute left-0 w-full'
                    }
                    style={{
                      top: isSelected ? undefined : 0,
                      zIndex,
                      viewTransitionName: isTransitioning
                        ? `card-${account.id}`
                        : undefined,
                    }}
                  >
                    {isSelected ? (
                      <button
                        type="button"
                        onClick={handleBack}
                        className="w-full"
                        aria-label={`Close ${account.name} card`}
                      >
                        {item}
                      </button>
                    ) : (
                      item
                    )}
                  </div>
                );
              }

              // Cards above selected: transition to off-screen at bottom
              // Use fixed positioning so they don't scroll into view
              const offsetBelowViewport =
                (index - selectedIndex - 1) * VERTICAL_CARD_OFFSET_IN_STACK;
              return (
                <div
                  key={account.id}
                  className="-translate-x-1/2 fixed left-1/2"
                  style={{
                    top: `calc(100vh + ${offsetBelowViewport}px)`,
                    width: CARD_WIDTH,
                    zIndex,
                    viewTransitionName: isTransitioning
                      ? `card-${account.id}`
                      : undefined,
                  }}
                >
                  <GiftCardItem
                    account={account}
                    image={getGiftCardImageByUrl(account.mintUrl)}
                    className="w-full max-w-none"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div
          className="mx-auto flex flex-col items-center px-4 pt-3 pb-8"
          style={{
            viewTransitionName: isTransitioning ? 'transactions' : undefined,
          }}
        >
          {balance && <MoneyWithConvertedAmount money={balance} size="md" />}

          <div className="mt-6 grid w-72 grid-cols-2 gap-10">
            <LinkWithViewTransition
              to={`/receive?accountId=${card.id}`}
              transition="slideUp"
              applyTo="newView"
            >
              <Button className="w-full px-7 py-6 text-lg">Add</Button>
            </LinkWithViewTransition>
            <LinkWithViewTransition
              to={`/send?accountId=${card.id}`}
              transition="slideUp"
              applyTo="newView"
            >
              <Button className="w-full px-7 py-6 text-lg">Send</Button>
            </LinkWithViewTransition>
          </div>

          <div className="mt-4 w-full max-w-sm pb-14">
            <TransactionList
              accountId={card.id}
              className="h-auto overflow-visible"
            />
          </div>
        </div>
      </PageContent>
    </Page>
  );
}
