import squarealphaMayCard from '~/assets/gift-cards/squarealphamay.agi.cash.webp';
import squaresantacruzCard from '~/assets/gift-cards/squaresantacruz.agi.cash.webp';

const OFFER_CARD_IMAGES: Record<string, string> = {
  'https://squarealphamay.agi.cash': squarealphaMayCard,
  'https://squaresantacruz.agi.cash': squaresantacruzCard,
};

/**
 * Returns the offer card image for a given mint URL, if one exists.
 */
export function getOfferCardImageByUrl(url: string): string | undefined {
  return OFFER_CARD_IMAGES[url];
}
