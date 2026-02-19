import { useMemo } from 'react';
import blockAndBeanCard from '~/assets/gift-cards/blockandbean.agi.cash.webp';
import compassCoffeeCard from '~/assets/gift-cards/compass.agi.cash.webp';
import mapleCard from '~/assets/gift-cards/maple.agi.cash.webp';
import pinkOwlCoffeeCard from '~/assets/gift-cards/pinkowl.agi.cash.webp';
import pubkeyCard from '~/assets/gift-cards/pubkey.agi.cash.webp';
import theShackCard from '~/assets/gift-cards/shack.agi.cash.webp';
import type { Currency } from '~/lib/money';
import { useAccounts } from '../accounts/account-hooks';

export type GiftCardInfo = {
  url: string;
  name: string;
  image: string;
  currency: Currency;
};

/**
 * Hardcoded list of gift cards available for discovery.
 */
export const GIFT_CARDS: GiftCardInfo[] = [
  {
    url: 'https://blockandbean.agi.cash',
    name: 'Block and Bean',
    image: blockAndBeanCard,
    currency: 'BTC',
  },
  {
    url: 'https://pubkey.agi.cash',
    name: 'Pubkey',
    image: pubkeyCard,
    currency: 'BTC',
  },
  {
    url: 'https://maple.agi.cash',
    name: 'Maple',
    image: mapleCard,
    currency: 'BTC',
  },
  {
    url: 'https://compass.agi.cash',
    name: 'Compass Coffee',
    image: compassCoffeeCard,
    currency: 'BTC',
  },
  {
    url: 'https://pinkowl.agi.cash',
    name: 'Pink Owl Coffee',
    image: pinkOwlCoffeeCard,
    currency: 'BTC',
  },
  {
    url: 'https://shack.agi.cash',
    name: 'The Shack',
    image: theShackCard,
    currency: 'BTC',
  },
];

/**
 * Returns the gift card image for a given URL, if one exists.
 */
export function getGiftCardImageByUrl(url: string): string | undefined {
  return GIFT_CARDS.find((card) => card.url === url)?.image;
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
