// Import loyalty card assets
import fakeAgiCashImage from '~/assets/fake.agi.cash.png';
import fake2AgiCashImage from '~/assets/fake2.agi.cash.png';
import fake4AgiCashImage from '~/assets/fake4.agi.cash.png';

export type CardData = {
  id: string;
  name: string;
  type: string;
  logo: string;
  mintUrl: string;
  balance: { amount: number; currency: 'BTC' | 'USD' };
  isSelected: boolean;
};

/**
 * Registry of available loyalty card assets
 * Maps mint domain to imported asset
 */
export const CARD_ASSET_REGISTRY: Record<string, string> = {
  'fake.agi.cash': fakeAgiCashImage,
  'fake2.agi.cash': fake2AgiCashImage,
  'fake4.agi.cash': fake4AgiCashImage,
};

/**
 * Converts a mint URL to a domain key for asset lookup
 * Example: "https://agi.cash" -> "agi.cash"
 */
export function mintUrlToDomain(mintUrl: string): string {
  return mintUrl.replace(/^https?:\/\//, '');
}

/**
 * Gets the card asset for a mint URL if it exists in the registry
 * Returns null if no custom asset is available
 */
export function getCardAsset(mintUrl: string): string | null {
  const domain = mintUrlToDomain(mintUrl);
  return CARD_ASSET_REGISTRY[domain] || null;
}

/**
 * Returns all available card assets for prefetching
 */
export function getAllCardAssets(): string[] {
  return Object.values(CARD_ASSET_REGISTRY);
}
