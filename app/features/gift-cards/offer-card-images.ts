import freeCoffeeTestCard from '~/assets/gift-cards/freecoffeetest.agi.cash.webp';
import squarealphaCard from '~/assets/gift-cards/squarealpha0421.agi.cash.webp';

const OFFER_CARD_IMAGES: Record<string, string> = {
  'https://freecoffeetest.agi.cash': freeCoffeeTestCard,
  'https://squarealpha0421.agi.cash': squarealphaCard,
};

/**
 * Returns the offer card image for a given mint URL, if one exists.
 * Normalizes the URL (lowercase + strip trailing slashes) so variations
 * entered by users resolve to the same key.
 */
export function getOfferCardImageByUrl(url: string): string | undefined {
  const normalized = url.toLowerCase().replace(/\/+$/, '');
  return OFFER_CARD_IMAGES[normalized];
}
