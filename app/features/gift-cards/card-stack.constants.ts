import { CARD_ASPECT_RATIO, CARD_SIZES } from '~/components/wallet-card';

/** Header height (56px) + gap (8px) */
export const CONTENT_TOP = 64;

export const CARD_WIDTH = CARD_SIZES.default.width;
export const CARD_HEIGHT = Math.round(CARD_WIDTH / CARD_ASPECT_RATIO);

/** Vertical offset between cards in collapsed stack */
export const COLLAPSED_OFFSET = 52;
