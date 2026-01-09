import type { CSSProperties } from 'react';

import {
  ANIMATION_DURATION_MS,
  BOUNCE_TIMING,
  CARD_HEIGHT,
  CASCADE_DELAY_PER_CARD_MS,
  COLLAPSED_OFFSET,
  CONTENT_TOP,
} from './card-stack.constants';

export type CardPosition = {
  top: number;
  left: number;
  width: number;
};

export type CapturedCardPosition = CardPosition & {
  index: number;
};

/**
 * Calculate Y position of a card in the collapsed stack relative to selected card
 */
export const getCollapsedY = (
  cardIndex: number,
  selectedIndex: number,
  baseTop: number,
): number => baseTop + (cardIndex - selectedIndex) * COLLAPSED_OFFSET;

/**
 * Create CSS transform string from position values
 */
export const toTransform = (left: number, top: number): string =>
  `translate(${left}px, ${top}px)`;

/**
 * Create initial card styles - all cards at collapsed positions with no transition.
 * Used as the starting state before entering animation begins.
 */
export function createInitialCardStyles(
  selectedIndex: number,
  cardCount: number,
  baseTop: number,
  baseLeft: number,
  cardWidth: number,
): Map<number, CSSProperties> {
  const styles = new Map<number, CSSProperties>();

  for (let i = 0; i < cardCount; i++) {
    styles.set(i, {
      transform: toTransform(
        baseLeft,
        getCollapsedY(i, selectedIndex, baseTop),
      ),
      width: cardWidth,
      opacity: 1,
      transition: 'none',
    });
  }

  return styles;
}

/**
 * Create entering animation styles:
 * - Selected card animates to the top of the screen
 * - Cards above fade out in place
 * - Cards below slide down and fade out
 */
export function createEnteringCardStyles(
  selectedIndex: number,
  cardCount: number,
  baseTop: number,
  baseLeft: number,
  centeredLeft: number,
  cardWidth: number,
): Map<number, CSSProperties> {
  const styles = new Map<number, CSSProperties>();
  const ease = `${ANIMATION_DURATION_MS}ms ease-out`;

  // Selected card animates to centered top position
  styles.set(selectedIndex, {
    transform: toTransform(centeredLeft, CONTENT_TOP),
    width: cardWidth,
    opacity: 1,
    transition: `transform ${ease}`,
  });

  // Cards above fade out in place
  for (let i = 0; i < selectedIndex; i++) {
    styles.set(i, {
      transform: toTransform(
        baseLeft,
        getCollapsedY(i, selectedIndex, baseTop),
      ),
      width: cardWidth,
      opacity: 0,
      transition: `opacity ${ease}`,
    });
  }

  // Cards below slide down past card height and fade out
  for (let i = selectedIndex + 1; i < cardCount; i++) {
    const hiddenY = getCollapsedY(i, selectedIndex, baseTop) + CARD_HEIGHT;
    styles.set(i, {
      transform: toTransform(baseLeft, hiddenY),
      width: cardWidth,
      opacity: 0,
      transition: `transform ${ease}, opacity ${ease}`,
    });
  }

  return styles;
}

/**
 * Create initial styles for exiting animation.
 * Positions match the entering animation's final state (selected centered, others hidden).
 * Used to ensure CSS transitions have a starting point.
 */
export function createExitingInitialCardStyles(
  selectedIndex: number,
  cardCount: number,
  baseTop: number,
  baseLeft: number,
  centeredLeft: number,
  cardWidth: number,
): Map<number, CSSProperties> {
  const styles = new Map<number, CSSProperties>();

  for (let i = 0; i < cardCount; i++) {
    const isSelected = i === selectedIndex;
    const isBelow = i > selectedIndex;

    if (isSelected) {
      // Selected card: at centered position (matches entering end state)
      styles.set(i, {
        transform: toTransform(centeredLeft, CONTENT_TOP),
        width: cardWidth,
        opacity: 1,
        transition: 'none',
      });
    } else if (isBelow) {
      // Cards below: slid down past card height and faded out
      const hiddenY = getCollapsedY(i, selectedIndex, baseTop) + CARD_HEIGHT;
      styles.set(i, {
        transform: toTransform(baseLeft, hiddenY),
        width: cardWidth,
        opacity: 0,
        transition: 'none',
      });
    } else {
      // Cards above: at collapsed positions, faded out
      styles.set(i, {
        transform: toTransform(
          baseLeft,
          getCollapsedY(i, selectedIndex, baseTop),
        ),
        width: cardWidth,
        opacity: 0,
        transition: 'none',
      });
    }
  }

  return styles;
}

/**
 * Create exiting animation styles - all cards return to collapsed positions.
 * Uses cascade delay for cards below to create a "falling into place" effect.
 */
export function createExitingCardStyles(
  selectedIndex: number,
  cardCount: number,
  getCardPosition: (index: number) => CardPosition,
): Map<number, CSSProperties> {
  const styles = new Map<number, CSSProperties>();

  for (let i = 0; i < cardCount; i++) {
    const pos = getCardPosition(i);
    const isBelow = i > selectedIndex;
    const isSelected = i === selectedIndex;
    const cascadeDelay = isBelow
      ? (i - selectedIndex) * CASCADE_DELAY_PER_CARD_MS
      : 0;

    // Cards above: no transition (appear instantly)
    // Selected card: transform transition only
    // Cards below: transform with bounce and cascade delay
    const transitionStyle: CSSProperties =
      isBelow || isSelected
        ? {
            transitionProperty: 'transform',
            transitionDuration: `${ANIMATION_DURATION_MS}ms`,
            transitionTimingFunction: isBelow ? BOUNCE_TIMING : 'ease-out',
            transitionDelay: cascadeDelay > 0 ? `${cascadeDelay}ms` : '0ms',
          }
        : {};

    styles.set(i, {
      transform: toTransform(pos.left, pos.top),
      width: pos.width,
      opacity: 1,
      ...transitionStyle,
    });
  }

  return styles;
}
