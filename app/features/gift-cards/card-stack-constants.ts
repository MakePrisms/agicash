import { CARD_ASPECT_RATIO, CARD_SIZES } from '~/components/wallet-card';

export const VERTICAL_CARD_OFFSET_IN_STACK = 52;

export const CARD_WIDTH = CARD_SIZES.default.width;
export const CARD_HEIGHT = Math.round(CARD_WIDTH / CARD_ASPECT_RATIO);
