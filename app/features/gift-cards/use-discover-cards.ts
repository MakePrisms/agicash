import { useMemo } from 'react';
import blockAndBeanCard from '~/assets/gift-cards/blockandbean.agi.cash.png';
import compassCoffeeCard from '~/assets/gift-cards/compass.agi.cash.png';
import fakeCard from '~/assets/gift-cards/fake.agi.cash.png';
import fake4Card from '~/assets/gift-cards/fake4.agi.cash.png';
import pinkOwlCoffeeCard from '~/assets/gift-cards/pinkowl.agi.cash.png';
import theShackCard from '~/assets/gift-cards/shack.agi.cash.png';
import type { Currency } from '~/lib/money';
import { useAccounts } from '../accounts/account-hooks';

export type DiscoverMint = {
  url: string;
  name: string;
  image: string;
  currency: Currency;
};

/**
 * Hardcoded list of mints available for discovery.
 */
export const DISCOVER_MINTS: DiscoverMint[] = [
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
 * Returns the card image for a given mint URL, if one exists.
 */
export function getCardImageByMintUrl(mintUrl: string): string | undefined {
  return DISCOVER_MINTS.find((mint) => mint.url === mintUrl)?.image;
}

/**
 * Returns discover cards that the user has not yet added.
 * Filters out mints where the user already has an account with matching url and currency.
 */
export function useDiscoverCards(): DiscoverMint[] {
  const { data: cashuAccounts } = useAccounts({ type: 'cashu' });

  return useMemo(() => {
    const existingMints = new Set(
      cashuAccounts.map((account) => `${account.mintUrl}:${account.currency}`),
    );

    return DISCOVER_MINTS.filter(
      (mint) => !existingMints.has(`${mint.url}:${mint.currency}`),
    );
  }, [cashuAccounts]);
}
