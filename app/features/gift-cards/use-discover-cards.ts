import { useMemo } from 'react';
import blockAndBeanCard from '~/assets/gift-cards/blockandbean.agi.cash.webp';
import compassCoffeeCard from '~/assets/gift-cards/compass.agi.cash.webp';
import mapleCard from '~/assets/gift-cards/maple.agi.cash.webp';
import pinkOwlCoffeeCard from '~/assets/gift-cards/pinkowl.agi.cash.webp';
import pubkeyCard from '~/assets/gift-cards/pubkey.agi.cash.webp';
import theShackCard from '~/assets/gift-cards/shack.agi.cash.webp';
import { useAccounts } from '../accounts/account-hooks';
import {
  type GiftCardConfig,
  JsonGiftCardConfigSchema,
} from './gift-card-config';

export type GiftCardInfo = GiftCardConfig & {
  image: string;
};

const GIFT_CARD_IMAGES: Record<string, string> = {
  'https://blockandbean.agi.cash': blockAndBeanCard,
  'https://pubkey.agi.cash': pubkeyCard,
  'https://maple.agi.cash': mapleCard,
  'https://compass.agi.cash': compassCoffeeCard,
  'https://pinkowl.agi.cash': pinkOwlCoffeeCard,
  'https://shack.agi.cash': theShackCard,
};

function loadGiftCardsFromEnv(): GiftCardInfo[] {
  const raw = import.meta.env.VITE_GIFT_CARDS;
  if (!raw) return [];

  // Validated at build time by vite.config.ts — safe to throw here.
  return JsonGiftCardConfigSchema.parse(raw).map((card) => ({
    ...card,
    image: GIFT_CARD_IMAGES[card.url] ?? '',
  }));
}

export const GIFT_CARDS: GiftCardInfo[] = loadGiftCardsFromEnv();

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
