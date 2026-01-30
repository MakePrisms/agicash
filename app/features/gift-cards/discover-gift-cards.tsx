import { useEffect, useRef } from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useViewTransitionState,
} from 'react-router';
import { z } from 'zod';
import {
  WalletCard,
  WalletCardBackgroundImage,
} from '~/components/wallet-card';
import useUserAgent from '~/hooks/use-user-agent';
import { cn } from '~/lib/utils';
import type { GiftCardInfo } from './use-discover-cards';

const DiscoverCardsLocationStateSchema = z.object({
  discoverScrollPosition: z.number(),
});

/**
 * Restores scroll position from navigation state when returning from add-gift-card page.
 * Returns the current scroll position for passing to child Link components.
 */
function useRestoreScrollPosition() {
  const location = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef(0);

  // Restore scroll position from navigation state
  useEffect(() => {
    const result = DiscoverCardsLocationStateSchema.safeParse(location.state);
    if (result.success && scrollRef.current) {
      scrollRef.current.scrollLeft = result.data.discoverScrollPosition;
    }
  }, [location.state]);

  const handleScroll = () => {
    if (scrollRef.current) {
      scrollPositionRef.current = scrollRef.current.scrollLeft;
    }
  };

  return { scrollRef, scrollPositionRef, handleScroll };
}

type DiscoverCardLinkProps = {
  card: GiftCardInfo;
  scrollPositionRef: React.RefObject<number>;
};

/**
 * Link wrapper for a discover card that applies view transition name when navigating forward only.
 * Passes current scroll position in navigation state for restoration on back navigation.
 */
function DiscoverCardLink({ card, scrollPositionRef }: DiscoverCardLinkProps) {
  const navigate = useNavigate();
  const to = `/gift-cards/add/${encodeURIComponent(card.url)}/${card.currency}`;
  const isNavigatingToThisCard = useViewTransitionState(to);

  // Use onClick to capture scroll position at click time, not render time
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(to, {
      viewTransition: true,
      state: {
        discoverScrollPosition: scrollPositionRef.current,
      } satisfies z.input<typeof DiscoverCardsLocationStateSchema>,
    });
  };

  return (
    <Link to={to} onClick={handleClick}>
      <WalletCard
        size="sm"
        style={{
          viewTransitionName: isNavigatingToThisCard
            ? 'discover-card'
            : undefined,
        }}
      >
        <WalletCardBackgroundImage src={card.image} alt={card.name} />
      </WalletCard>
    </Link>
  );
}

type DiscoverSectionProps = {
  giftCards: GiftCardInfo[];
};

/**
 * Horizontal scroll carousel of available gift cards for discovery.
 * Persists scroll position when navigating to/from add-gift-card page.
 */
export function DiscoverGiftCards({ giftCards }: DiscoverSectionProps) {
  const { isMobile } = useUserAgent();
  const isTransitioningToCard = useViewTransitionState(
    '/gift-cards/:accountId',
  );
  const isTransitioningToAdd = useViewTransitionState(
    '/gift-cards/add/:mintUrl/:currency',
  );
  const isTransitioning = isTransitioningToCard || isTransitioningToAdd;
  const { scrollRef, scrollPositionRef, handleScroll } =
    useRestoreScrollPosition();

  return (
    <div
      className="w-full shrink-0 overflow-hidden"
      style={{
        viewTransitionName: isTransitioning ? 'available-cards' : undefined,
      }}
    >
      <h2
        className="mb-3 px-4 text-white"
        style={{
          viewTransitionName: isTransitioning ? 'discover-heading' : undefined,
        }}
      >
        Discover
      </h2>
      <div className="sm:px-4">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className={cn(
            'overflow-x-auto pb-1',
            isMobile
              ? 'scrollbar-none'
              : '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:h-1.5',
          )}
        >
          <div className="flex w-max gap-3 px-4 pb-2 sm:px-0">
            {giftCards.map((card) => (
              <DiscoverCardLink
                key={`${card.url}:${card.currency}`}
                card={card}
                scrollPositionRef={scrollPositionRef}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
