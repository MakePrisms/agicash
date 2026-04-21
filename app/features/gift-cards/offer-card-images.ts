import freeCoffeeTestCard from '~/assets/gift-cards/freecoffeetest.agi.cash.webp';
import squarealphaCard from '~/assets/gift-cards/squarealpha0421.agi.cash.webp';

const OFFER_CARD_IMAGES: Record<string, string> = {
  'https://freecoffeetest.agi.cash': freeCoffeeTestCard,
  'https://squarealpha0421.agi.cash': squarealphaCard,
};

/**
 * Returns the offer card image for a given mint URL, if one exists.
 */
export function getOfferCardImageByUrl(url: string): string | undefined {
  return OFFER_CARD_IMAGES[url];
}
