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
  children: React.ReactNode;
};

/**
 * Link wrapper for a discover card that applies view transition name when navigating forward only.
 * Passes current scroll position in navigation state for restoration on back navigation.
 */
function DiscoverCardLink({
  card,
  scrollPositionRef,
  children,
}: DiscoverCardLinkProps) {
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
    <Link
      to={to}
      onClick={handleClick}
      style={{
        viewTransitionName: isNavigatingToThisCard
          ? 'discover-card'
          : undefined,
      }}
    >
      {children}
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
  const isTransitioning = useViewTransitionState('/gift-cards/:accountId');
  const { scrollRef, scrollPositionRef, handleScroll } =
    useRestoreScrollPosition();

  return (
    <div
      className="w-full shrink-0"
      style={{
        viewTransitionName: isTransitioning ? 'available-cards' : undefined,
      }}
    >
      <h2 className="mb-3 px-4 text-white">Discover</h2>
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
          <div className="flex w-max gap-3 pb-2">
            {giftCards.map((card, index) => (
              <DiscoverCardLink
                key={`${card.url}:${card.currency}`}
                card={card}
                scrollPositionRef={scrollPositionRef}
              >
                <WalletCard
                  size="sm"
                  className={cn(
                    index === 0 && 'ml-4 sm:ml-0',
                    index === giftCards.length - 1 && 'mr-4 sm:mr-0',
                  )}
                >
                  <WalletCardBackgroundImage src={card.image} alt={card.name} />
                </WalletCard>
              </DiscoverCardLink>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
