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
import { OfferItem } from './offer-item';
import {
  getGiftCardImageByUrl,
  useDiscoverGiftCards,
} from './use-discover-cards';

// TODO: Replace client-side expiry filtering with `account.state === 'active'`
// once the account state lifecycle (PR #960) lands.
function useActiveOffers() {
  const { data: offerAccounts } = useAccounts({ purpose: 'offer' });
  const now = Date.now();
  return offerAccounts.filter(
    (account) =>
      !account.expiresAt || new Date(account.expiresAt).getTime() > now,
  );
}

/**
 * Gift cards view with discover section, card stack, and offers.
 * Clicking a card navigates to the card details page with view transitions.
 */
export function GiftCards() {
  const { data: accounts } = useAccounts({
    purpose: 'gift-card',
  });

  const navigate = useNavigate();
  const isGiftCardTransitioning = useViewTransitionState(
    '/gift-cards/:accountId',
  );
  const isOfferCardTransitioning = useViewTransitionState(
    '/gift-cards/offers/:accountId',
  );

  const hasCards = accounts.length > 0;
  const stackedHeight =
    CARD_HEIGHT + (accounts.length - 1) * VERTICAL_CARD_OFFSET_IN_STACK;
  const giftCardsToDiscover = useDiscoverGiftCards();
  const activeOffers = useActiveOffers();

  const handleCardClick = (account: CashuAccount) => {
    navigate(`/gift-cards/${account.id}`, { viewTransition: true });
  };

  const handleOfferClick = (account: CashuAccount) => {
    navigate(`/gift-cards/offers/${account.id}`, { viewTransition: true });
  };

  return (
    <Page className="px-0 pb-0">
      <PageHeader className="absolute inset-x-0 top-0 z-20 flex w-full items-center justify-between px-4 pt-4 pb-4">
        <ClosePageButton to="/" transition="slideLeft" applyTo="oldView" />
        <PageHeaderTitle>Gift Cards</PageHeaderTitle>
      </PageHeader>

      <PageContent className="scrollbar-none relative min-h-0 overflow-y-auto px-0 pt-16 pb-0">
        <div className="flex w-full flex-col items-center gap-4">
          {giftCardsToDiscover.length > 0 && (
            <DiscoverGiftCards giftCards={giftCardsToDiscover} />
          )}

          {activeOffers.length > 0 && (
            <div className="flex w-full shrink-0 flex-col items-center px-4 pb-8">
              <h2 className="mb-3 w-full text-white">Offers</h2>
              <div
                className="flex w-full flex-col gap-3"
                style={{ maxWidth: CARD_WIDTH }}
              >
                {activeOffers.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => handleOfferClick(account)}
                    aria-label={`View ${account.name} offer`}
                    className="w-full"
                    style={{
                      viewTransitionName: isOfferCardTransitioning
                        ? `offer-${account.id}`
                        : undefined,
                    }}
                  >
                    <OfferItem account={account} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasCards ? (
            <div className="flex w-full shrink-0 flex-col items-center pb-8">
              <h2 className="mb-3 w-full px-4 text-white">Your Cards</h2>
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
                        viewTransitionName: isGiftCardTransitioning
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
          ) : activeOffers.length === 0 ? (
            <EmptyState />
          ) : null}
        </div>
      </PageContent>
    </Page>
  );
}
