import type { GiftCardInfo } from '@agicash/wallet-sdk';
import { useMemo } from 'react';
import { useAccounts } from '../accounts/account-hooks';
import { JsonGiftCardConfigSchema } from './gift-card-config';
import {
  getGiftCardImageByUrl,
  getGiftCardOgImageByUrl,
} from './gift-card-images';

function loadGiftCardsFromEnv(): GiftCardInfo[] {
  const raw = import.meta.env.VITE_GIFT_CARDS;
  if (!raw) return [];
  return JsonGiftCardConfigSchema.parse(raw).map((card) => ({
    ...card,
    image: getGiftCardImageByUrl(card.url) ?? '',
    ogImage: getGiftCardOgImageByUrl(card.url),
  }));
}

export const GIFT_CARDS: GiftCardInfo[] = loadGiftCardsFromEnv();

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
      (mint) =>
        mint.isDiscoverable &&
        !existingGiftCardAccounts.has(`${mint.url}:${mint.currency}`),
    );
  }, [cashuAccounts]);
}
