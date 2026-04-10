import sfFreeCoffeeCard from '~/assets/gift-cards/sf-free-coffee.webp';
import {
  JsonOfferCardConfigSchema,
  type OfferCardConfig,
} from './offer-card-config';

export type OfferCardInfo = OfferCardConfig & {
  image: string;
};

const OFFER_CARD_IMAGES: Record<string, string> = {
  'http://localhost:8104': sfFreeCoffeeCard,
};

function loadOfferCardsFromEnv(): OfferCardInfo[] {
  const raw = import.meta.env.VITE_OFFER_CARDS;
  if (!raw) return [];

  return JsonOfferCardConfigSchema.parse(raw).map((card) => {
    const image = OFFER_CARD_IMAGES[card.url];
    if (!image) {
      throw new Error(
        `Missing image for offer card: ${card.url}. Add an entry to OFFER_CARD_IMAGES.`,
      );
    }
    return { ...card, image };
  });
}

export const OFFER_CARDS: OfferCardInfo[] = loadOfferCardsFromEnv();

/**
 * Returns the offer card image for a given mint URL, if one exists.
 */
export function getOfferCardImageByUrl(url: string): string | undefined {
  return OFFER_CARDS.find((card) => card.url === url)?.image;
}
