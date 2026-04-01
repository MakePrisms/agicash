import { useMemo } from 'react';
import blockAndBeanCard from '~/assets/gift-cards/blockandbean.agi.cash.webp';
import compassCoffeeCard from '~/assets/gift-cards/compass.agi.cash.webp';
import mapleCard from '~/assets/gift-cards/maple.agi.cash.webp';
import pinkOwlCoffeeCard from '~/assets/gift-cards/pinkowl.agi.cash.webp';
import pubkeyCard from '~/assets/gift-cards/pubkey.agi.cash.webp';
import sfFreeCoffeeCard from '~/assets/gift-cards/sf-free-coffee.webp';
import theShackCard from '~/assets/gift-cards/shack.agi.cash.webp';
import theEpicurianTraderCard from '~/assets/gift-cards/theepicureantrader.agi.cash.webp';
import { useAccounts } from '../accounts/account-hooks';
import {
  type GiftCardConfig,
  JsonGiftCardConfigSchema,
} from './gift-card-config';
import {
  JsonOfferCardConfigSchema,
  type OfferCardConfig,
} from './offer-card-config';

export type CardInfo = {
  url: string;
  name: string;
  image: string;
  addCardDisclaimer?: string;
};

export type GiftCardInfo = GiftCardConfig & {
  image: string;
};

const CARD_IMAGES: Record<string, string> = {
  'https://blockandbean.agi.cash': blockAndBeanCard,
  'https://pubkey.agi.cash': pubkeyCard,
  'https://maple.agi.cash': mapleCard,
  'https://compass.agi.cash': compassCoffeeCard,
  'https://pinkowl.agi.cash': pinkOwlCoffeeCard,
  'https://shack.agi.cash': theShackCard,
  'https://theepicureantrader.agi.cash': theEpicurianTraderCard,
  'http://localhost:8104': sfFreeCoffeeCard,
};

function loadGiftCardsFromEnv(): GiftCardInfo[] {
  const raw = import.meta.env.VITE_GIFT_CARDS;
  if (!raw) return [];

  // Validated at build time by vite.config.ts — safe to throw here.
  return JsonGiftCardConfigSchema.parse(raw).map((card) => ({
    ...card,
    image: CARD_IMAGES[card.url] ?? '',
  }));
}

type OfferCardInfo = OfferCardConfig & {
  image: string;
};

function loadOfferCardsFromEnv(): OfferCardInfo[] {
  const raw = import.meta.env.VITE_OFFER_CARDS;
  if (!raw) return [];

  return JsonOfferCardConfigSchema.parse(raw).map((card) => {
    const image = CARD_IMAGES[card.url];
    if (!image) {
      throw new Error(
        `Missing image for offer card: ${card.url}. Add an entry to CARD_IMAGES.`,
      );
    }
    return { ...card, image };
  });
}

export const GIFT_CARDS: GiftCardInfo[] = loadGiftCardsFromEnv();
export const OFFER_CARDS: OfferCardInfo[] = loadOfferCardsFromEnv();

/**
 * Returns the gift card image for a given URL, if one exists.
 */
export function getGiftCardImageByUrl(url: string): string | undefined {
  return GIFT_CARDS.find((card) => card.url === url)?.image;
}

/**
 * Returns the gift card info for a given mint URL, if one exists.
 */
export function getGiftCardByUrl(url: string): GiftCardInfo | undefined {
  return GIFT_CARDS.find((card) => card.url === url);
}

/**
 * Returns card info (image, name, etc.) for a given mint URL,
 * regardless of whether it's a gift card or offer card.
 */
export function getCardByUrl(url: string): CardInfo | undefined {
  const giftCard = GIFT_CARDS.find((card) => card.url === url);
  if (giftCard) return giftCard;
  const offerCard = OFFER_CARDS.find((card) => card.url === url);
  if (offerCard) return offerCard;
  return undefined;
}

/**
 * Returns gift cards that the user has not yet added.
 */
export function useDiscoverGiftCards(): GiftCardInfo[] {
  const { data: cashuAccounts } = useAccounts({ type: 'cashu' });

  return useMemo(() => {
    const existingGiftCardAccounts = new Set(
      cashuAccounts.map((account) => `${account.mintUrl}:${account.currency}`),
    );

    return GIFT_CARDS.filter(
      (mint) => !existingGiftCardAccounts.has(`${mint.url}:${mint.currency}`),
    );
  }, [cashuAccounts]);
}
