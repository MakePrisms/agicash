import { CARD_ASPECT_RATIO, CARD_SIZES } from '~/components/wallet-card';

// ============================================================================
// Animation Timing
// ============================================================================

export const ANIMATION_DURATION_MS = 300;
export const CASCADE_DELAY_PER_CARD_MS = 50;
export const BOUNCE_TIMING = 'cubic-bezier(0.34, 1.15, 0.64, 1)';

// ============================================================================
// Layout Dimensions
// ============================================================================

/** Header height (56px) + gap (8px) */
export const CONTENT_TOP = 64;

export const CARD_WIDTH = CARD_SIZES.default.width;
export const CARD_HEIGHT = Math.round(CARD_WIDTH / CARD_ASPECT_RATIO);

/** Vertical offset between cards in collapsed stack */
export const COLLAPSED_OFFSET = 52;
