import { useMemo } from 'react';

// Card stacking configuration constants
// Card has 24px top padding (p-6), ~40px name row height, so 88px creates equal spacing above/below name row
const CARD_STACK_OFFSET = 88; // Space between cards in collapsed stack (px)
const EXPANDED_CARD_TOP_POSITION = 0; // Top position for expanded card (px)
const OFF_SCREEN_BUFFER = 100; // Extra buffer when sliding cards off-screen (px)

interface CardStackAnimationOptions {
  index: number;
  isExpanded: boolean;
  expandedCardIndex: number | null;
  animationSpeed: number;
}

interface CardStackAnimationResult {
  transform: string;
  zIndex: number;
  transitionDelay: string;
  position: 'absolute';
  top: string;
  width: string;
}

/**
 * Hook for managing card stack positioning and animation timing.
 * Handles the complex logic for stacking, expanding, and sliding cards with staggered delays.
 */
export function useCardStackAnimation({
  index,
  isExpanded,
  expandedCardIndex,
  animationSpeed,
}: CardStackAnimationOptions): CardStackAnimationResult {
  return useMemo(() => {
    const stackOffset = CARD_STACK_OFFSET;
    const expandedTopPosition = EXPANDED_CARD_TOP_POSITION;
    const offScreenOffset = window?.innerHeight
      ? window.innerHeight + OFF_SCREEN_BUFFER
      : 800; // Fallback for SSR

    // Determine positioning based on card state and expanded card
    let yOffset: number;
    let transitionDelay: string;

    if (isExpanded) {
      // This card is expanded - move to expanded position
      yOffset = expandedTopPosition;
      transitionDelay = '0ms'; // Expanded card moves immediately
    } else if (expandedCardIndex !== null) {
      // There's an expanded card - slide all other cards down in continuous order
      yOffset = index * stackOffset + offScreenOffset;
      transitionDelay = `${index * (animationSpeed / 12)}ms`;
    } else {
      // No expanded card - normal stacking, stagger the entry animation
      yOffset = index * stackOffset;
      transitionDelay = `${index * (animationSpeed / 6)}ms`;
    }

    // Fixed z-index based on card position - never changes regardless of state
    // This prevents flashing and reordering during animations
    const zIndex = 100 + index;

    return {
      transform: `translateY(${yOffset}px)`,
      zIndex,
      transitionDelay,
      position: 'absolute' as const,
      top: '0',
      width: '100%',
    };
  }, [index, isExpanded, expandedCardIndex, animationSpeed]);
}
