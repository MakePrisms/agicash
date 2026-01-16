import { useMemo } from 'react';
import blockAndBeanCard from '~/assets/gift-cards/blockandbean.agi.cash.webp';
import compassCoffeeCard from '~/assets/gift-cards/compass.agi.cash.webp';
import fakeCard from '~/assets/gift-cards/fake.agi.cash.webp';
import fake4Card from '~/assets/gift-cards/fake4.agi.cash.webp';
import pinkOwlCoffeeCard from '~/assets/gift-cards/pinkowl.agi.cash.webp';
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
 * Hardcoded list of gift cardsavailable for discovery.
 */
export const GIFT_CARDS: GiftCardInfo[] = [
  {
    url: 'https://blockandbean.agi.cash',
    name: 'Block and Bean',
    image: blockAndBeanCard,
    currency: 'BTC',
  },
  {
    url: 'https://fake.agi.cash',
    name: 'Pubkey',
    image: fakeCard,
    currency: 'BTC',
  },
  {
    url: 'https://fake4.agi.cash',
    name: 'Maple',
    image: fake4Card,
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
export function getGiftCardImageByMintUrl(url: string): string | undefined {
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
