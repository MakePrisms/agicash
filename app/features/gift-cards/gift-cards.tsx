import { useNavigate, useViewTransitionState } from 'react-router';
import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import type { CashuAccount } from '~/features/accounts/account';
import { useAccounts } from '../accounts/account-hooks';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  VERTICAL_CARD_OFFSET_IN_STACK,
} from './card-stack-constants';
import { DiscoverGiftCards } from './discover-gift-cards';
import { EmptyState } from './empty-state';
import { GiftCardItem } from './gift-card-item';
import {
  getGiftCardImageByUrl,
  useDiscoverGiftCards,
} from './use-discover-cards';

/**
 * Gift cards view with discover section and card stack.
 * Clicking a card navigates to the card details page with view transitions.
 */
export function GiftCards() {
  const { data: accounts } = useAccounts({
    purpose: 'gift-card',
  });

  const navigate = useNavigate();
  const isTransitioningToCard = useViewTransitionState(
    '/gift-cards/:accountId',
  );
  const isTransitioningToAdd = useViewTransitionState(
    '/gift-cards/add/:mintUrl/:currency',
  );
  const isTransitioning = isTransitioningToCard || isTransitioningToAdd;

  const hasCards = accounts.length > 0;
  const stackedHeight =
    CARD_HEIGHT + (accounts.length - 1) * VERTICAL_CARD_OFFSET_IN_STACK;
  const giftCardsToDiscover = useDiscoverGiftCards();

  const handleCardClick = (account: CashuAccount) => {
    navigate(`/gift-cards/${account.id}`, { viewTransition: true });
  };

  return (
    <Page className="px-0 pb-0">
      <PageHeader
        className="absolute inset-x-0 top-0 z-20 flex w-full items-center justify-between px-4 pt-4 pb-4"
        style={{
          viewTransitionName: isTransitioning ? 'gift-cards-header' : undefined,
        }}
      >
        <ClosePageButton to="/" transition="slideLeft" applyTo="oldView" />
        <PageHeaderTitle>Gift Cards</PageHeaderTitle>
      </PageHeader>

      <PageContent className="scrollbar-none relative min-h-0 overflow-y-auto px-0 pt-16 pb-0">
        <div className="flex w-full flex-col items-center gap-4">
          {giftCardsToDiscover.length > 0 && (
            <DiscoverGiftCards giftCards={giftCardsToDiscover} />
          )}

          {hasCards ? (
            <div className="relative z-10 flex w-full shrink-0 flex-col items-center pb-8">
              <h2
                className="mb-3 w-full px-4 text-white"
                style={{
                  viewTransitionName: isTransitioningToAdd
                    ? 'your-cards-heading'
                    : undefined,
                }}
              >
                Your Cards
              </h2>
              <div className="w-full px-4">
                <div
                  className="relative mx-auto w-full"
                  style={{ height: stackedHeight, maxWidth: CARD_WIDTH }}
                >
                  {accounts.map((account, index) => (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => handleCardClick(account)}
                      aria-label={`Select ${account.name} card, ${index + 1} of ${accounts.length}`}
                      className="absolute left-0 w-full"
                      style={{
                        transform: `translateY(${index * VERTICAL_CARD_OFFSET_IN_STACK}px)`,
                        zIndex: 1 + index,
                        viewTransitionName: isTransitioningToCard
                          ? `card-${account.id}`
                          : undefined,
                      }}
                    >
                      <GiftCardItem
                        account={account}
                        image={getGiftCardImageByUrl(account.mintUrl)}
                        className="w-full max-w-none"
                      />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                viewTransitionName: isTransitioningToAdd
                  ? 'empty-state'
                  : undefined,
              }}
            >
              <EmptyState />
            </div>
          )}
        </div>
      </PageContent>
    </Page>
  );
}
