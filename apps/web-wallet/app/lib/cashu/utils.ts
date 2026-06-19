import type { Currency, CurrencyUnit } from '@agicash/money';
import { ExtendedCashuWallet } from '@agicash/wallet-sdk';
import type { Keyset, MintKeyset, Wallet } from '@cashu/cashu-ts';
import type { Token } from '@cashu/cashu-ts';
import type { DistributedOmit } from 'type-fest';
import type { ExtendedMintInfo, MintPurpose } from './protocol-extensions';
import { CASHU_PROTOCOL_UNITS, type CashuProtocolUnit } from './types';

// The agicash-extended cashu wallet class is owned by @agicash/wallet-sdk (the
// two declarations were byte-identical). Re-exporting it keeps `~/lib/cashu` as
// the web's import site while unifying on a single class, so `account.wallet`
// and `getCashuWallet(...)` share one nominal type.
export { ExtendedCashuWallet };

const knownTestMints = [
  'https://testnut.cashu.space',
  'https://nofees.testnut.cashu.space',
];

const currencyToUnit: {
  [K in Currency]: CurrencyUnit<K>;
} = {
  BTC: 'sat',
  USD: 'cent',
};

const currencyToCashuProtocolUnit: {
  [K in Currency]: CashuProtocolUnit;
} = {
  BTC: 'sat',
  USD: 'usd',
};

const cashuProtocolUnitToCurrency: {
  [key in CashuProtocolUnit]: Currency;
} = {
  sat: 'BTC',
  usd: 'USD',
};

/**
 * Gets the unit that should be used when dealing with amounts from Cashu in the rest of the application.
 * Cashu uses 'usd' to represent cent values which is confusing, so we map it to 'cent'.
 *
 * See `getCashuProtocolUnit` for getting the unit to use when interfacing with the Cashu protocol.
 *
 * @param currency - The currency to get the unit for
 * @returns The unit ('sat' for BTC, 'cent' for USD)
 */
export const getCashuUnit = (currency: Currency) => {
  return currencyToUnit[currency];
};

/**
 * Gets the unit that the Cashu protocol expects for a given currency.
 * These units are not defined in Cashu, but there is a convention that
 * the amounts are in the smallest unit of the specified currency.
 *
 * For example, the cashu protocol unit for USD is 'usd' and represents amounts in cents.
 *
 * See `getCashuUnit` for getting the unit to use when dealing with amounts from Cashu in the rest of the application.
 *
 * @param currency - The currency to get the protocol unit for
 * @returns The Cashu protocol unit ('sat' for BTC, 'usd' for USD amounts in cents)
 */
export const getCashuProtocolUnit = (currency: Currency) => {
  return currencyToCashuProtocolUnit[currency];
};

export type CashuTokenValidation =
  | { isTokenSupported: true }
  | { isTokenSupported: false; message: string };

/**
 * Validates that a decoded Cashu token is one Agicash supports.
 */
export const validateCashuToken = (token: Token): CashuTokenValidation => {
  if (
    token.unit === undefined ||
    !(token.unit in cashuProtocolUnitToCurrency)
  ) {
    return {
      isTokenSupported: false,
      message: `This token's unit isn't supported. Supported units: ${CASHU_PROTOCOL_UNITS.join(', ')}.`,
    };
  }
  return { isTokenSupported: true };
};

/**
 * Determines the purpose of a mint based on its info.
 */
export const getMintPurpose = (
  mintInfo: ExtendedMintInfo | null | undefined,
): MintPurpose => {
  return mintInfo?.agicash?.purpose ?? 'transactional';
};

/**
 * Finds the first active keyset for the given currency.
 */
export const findFirstActiveKeyset = <T extends MintKeyset | Keyset>(
  keysets: T[],
  currency: Currency,
): T | undefined => {
  const unit = getCashuProtocolUnit(currency);
  return keysets.find((ks) => ks.unit === unit && ks.active);
};

/**
 * Returns the keyset's expiry as a Date, or null if it has no expiry.
 */
export const getKeysetExpiry = (keyset: MintKeyset | Keyset): Date | null => {
  if (!keyset.final_expiry) return null;
  return new Date(keyset.final_expiry * 1000);
};

export const getWalletCurrency = (wallet: Wallet) => {
  const unit = wallet.unit as keyof typeof cashuProtocolUnitToCurrency;
  if (!cashuProtocolUnitToCurrency[unit]) {
    throw new Error(`Unsupported cashu wallet unit: ${unit}`);
  }
  return cashuProtocolUnitToCurrency[unit];
};

export const getCashuWallet = (
  mintUrl: string,
  options: DistributedOmit<ConstructorParameters<typeof Wallet>[1], 'unit'> & {
    unit?: CurrencyUnit;
  } = {},
) => {
  const { unit, ...rest } = options;
  // Cashu calls the unit 'usd' even though the amount is in cents.
  // To avoid this confusion we use 'cent' everywhere and then here we switch the value to 'usd' before creating the Cashu wallet.
  const cashuUnit = options.unit === 'cent' ? 'usd' : options.unit;
  return new ExtendedCashuWallet(mintUrl, {
    ...rest,
    unit: cashuUnit,
  });
};

/**
 * Normalize a mint URL by trimming whitespace and stripping
 * trailing slashes. Use this whenever a mint URL is stored or compared.
 * This lowercases only the scheme and hostname, while preserving the
 * original casing of the path/query/hash because path segments can be
 * case-sensitive on some mints (for example `/Bitcoin` vs `/bitcoin`).
 */
export const normalizeMintUrl = (mintUrl: string): string => {
  const trimmed = mintUrl.trim().replace(/\/+$/, '');

  try {
    const url = new URL(trimmed);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
};

/**
 * Check if a mint is a test mint by checking if the mint is in the list of
 * known test mints.
 *
 * Known test mints:
 * - https://testnut.cashu.space
 * - https://nofees.testnut.cashu.space
 *
 * @param mintUrl - The URL of the mint
 * @returns True if the mint is a known test mint
 */
export const checkIsTestMint = (mintUrl: string): boolean => {
  return knownTestMints.includes(normalizeMintUrl(mintUrl));
};

/**
 * Check if two mint URLs are equal by normalizing them then comparing them.
 * @param a - The first mint URL
 * @param b - The second mint URL
 * @returns True if the mint URLs are equal
 */
export const areMintUrlsEqual = (a: string, b: string) => {
  return normalizeMintUrl(a) === normalizeMintUrl(b);
};
