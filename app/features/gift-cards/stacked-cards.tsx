import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigation } from 'react-router';

import type { CashuAccount } from '~/features/accounts/account';

import {
  CARD_HEIGHT,
  CARD_WIDTH,
  COLLAPSED_OFFSET,
} from './card-stack.constants';
import { GiftCardItem } from './gift-card-item';
import { getCardImageByMintUrl } from './use-discover-cards';

type StackedCardsProps = {
  accounts: CashuAccount[];
};

type LocationState = {
  transitioningCardId?: string;
};

/** Duration of the gift card morph animation in ms (actual CSS is 180ms) */
const VIEW_TRANSITION_DURATION = 300;
/** How early before transition ends to start the cascade (creates unified motion) */
const CASCADE_OVERLAP = 80;
/** Stagger delay between each card in the cascade animation */
const CASCADE_STAGGER_DELAY = 50;
/** Duration of each card's cascade animation */
const CASCADE_ANIMATION_DURATION = 250;

/**
 * Renders the collapsed card stack with overlapping cards.
 * Each card is positioned absolutely with a vertical offset.
 * Uses view-transition-name for element morphing when navigating to detail view.
 * Cards above the transitioning card stay in place while the selected card slides out/in.
 * Cards below the transitioning card cascade back in after the view transition completes.
 */
export function StackedCards({ accounts }: StackedCardsProps) {
  const stackedHeight = CARD_HEIGHT + (accounts.length - 1) * COLLAPSED_OFFSET;
  const [navigatingCardId, setNavigatingCardId] = useState<string | null>(null);
  const [cascadeAnimating, setCascadeAnimating] = useState(false);

  const navigation = useNavigation();

  // Get accountId from location state when navigating back from detail view
  const location = useLocation();
  const locationState = location.state as LocationState | null;
  const returningCardId = locationState?.transitioningCardId;

  // Determine which card is transitioning
  const transitioningCardId = navigatingCardId ?? returningCardId;
  const transitioningIndex = transitioningCardId
    ? accounts.findIndex((a) => a.id === transitioningCardId)
    : -1;

  // Track if we're returning from detail view (cards below should be hidden until cascade)
  const [isReturning, setIsReturning] = useState(false);

  // Detect when we're returning from detail view and hide cards below
  useEffect(() => {
    if (returningCardId) {
      setIsReturning(true);
    }
  }, [returningCardId]);

  // Trigger cascade animation when returning from detail view
  useEffect(() => {
    if (navigation.state === 'idle' && isReturning && returningCardId) {
      // Start cascade slightly before view transition ends for unified motion
      const cascadeStart = VIEW_TRANSITION_DURATION - CASCADE_OVERLAP;
      const timer = setTimeout(() => {
        setCascadeAnimating(true);
      }, cascadeStart);

      return () => clearTimeout(timer);
    }
  }, [navigation.state, isReturning, returningCardId]);

  // Reset animation states after cascade completes
  useEffect(() => {
    if (!cascadeAnimating) return;

    const cardsBelow = accounts.length - 1 - transitioningIndex;
    const totalDuration =
      CASCADE_ANIMATION_DURATION + cardsBelow * CASCADE_STAGGER_DELAY;

    const timer = setTimeout(() => {
      setCascadeAnimating(false);
      setIsReturning(false);
    }, totalDuration);

    return () => clearTimeout(timer);
  }, [cascadeAnimating, accounts.length, transitioningIndex]);

  // Only the transitioning card gets the view-transition-name
  const getTransitionName = (accountId: string) => {
    return transitioningCardId === accountId ? 'gift-card' : 'none';
  };

  /**
   * Returns animation styles for cards below the transitioning card.
   * When returning from detail view:
   * - Cards are initially hidden (opacity: 0)
   * - Then cascade in with staggered delays for a smooth wallet effect
   * Uses CSS variables to preserve the card's base Y position during animation.
   */
  const getCascadeStyle = (
    index: number,
  ): React.CSSProperties & { '--cascade-offset'?: string } => {
    const baseOffset = index * COLLAPSED_OFFSET;

    // Only affect cards below the transitioning card during return navigation
    if (transitioningIndex === -1 || index <= transitioningIndex) return {};
    if (!isReturning) return {};

    // Hide cards before cascade animation starts
    if (!cascadeAnimating) {
      return { opacity: 0 };
    }

    // Animate cards in with staggered delays
    const relativeIndex = index - transitioningIndex - 1;
    const delay = relativeIndex * CASCADE_STAGGER_DELAY;

    return {
      '--cascade-offset': `${baseOffset}px`,
      animation: `cascade-in ${CASCADE_ANIMATION_DURATION}ms cubic-bezier(0.22, 0.61, 0.36, 1) ${delay}ms both`,
    } as React.CSSProperties;
  };

  return (
    <div className="flex w-full shrink-0 flex-col items-center pb-8">
      <h2 className="mb-3 w-full px-4 text-white">Your Cards</h2>
      <div className="w-full px-4">
        <div
          className="relative mx-auto w-full"
          style={{ height: stackedHeight, maxWidth: CARD_WIDTH }}
        >
          {accounts.map((account, index) => {
            const cascadeStyle = getCascadeStyle(index);
            const isAnimating = 'animation' in cascadeStyle;

            return (
              <Link
                key={account.id}
                to={`/gift-cards/${account.id}`}
                viewTransition
                prefetch="viewport"
                onClick={() => setNavigatingCardId(account.id)}
                aria-label={`Select ${account.name} card, ${index + 1} of ${accounts.length}`}
                className="absolute left-0 block w-full"
                style={{
                  // When animating, the keyframes handle the transform via CSS variable
                  transform: isAnimating
                    ? undefined
                    : `translateY(${index * COLLAPSED_OFFSET}px)`,
                  zIndex: 1 + index,
                  viewTransitionName: getTransitionName(account.id),
                  ...cascadeStyle,
                }}
              >
                <GiftCardItem
                  account={account}
                  image={getCardImageByMintUrl(account.mintUrl)}
                  className="w-full max-w-none"
                />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
