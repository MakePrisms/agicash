import {
  type GetKeysResponse,
  type GetKeysetsResponse,
  KeyChain,
  Mint,
  NetworkError,
  type Token,
  getEncodedToken,
} from '@cashu/cashu-ts';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import type { Cache } from '../../interfaces/cache';
import type { KeyProvider } from '../../interfaces/key-provider';
import {
  type ExtendedCashuWallet,
  ExtendedMintInfo,
  getCashuProtocolUnit,
  getCashuUnit,
  getCashuWallet,
  sumProofs,
} from '../../lib/cashu';
import { type Currency, type CurrencyUnit, Money } from '../../lib/money';
import { computeSHA256 } from '../../lib/sha256';
import { measureOperation } from '../../performance';
import { getSeedPhraseDerivationPath } from '../accounts/account-cryptography';

// Cashu-specific derivation path with hardnened indexes to derive public keys for
// locking mint quotes and proofs. 129372 is UTF-8 for the peanut emoji (see NUT-13) and the other
// 2 indexes are the coin type (0) and account (0) which can be changed to derive
// different keys if needed. This path is "proprietary" and not part of any standard.
// The index values are unimportant as long as they are hardened and remain constant.
// DO NOT CHANGE THIS VALUE WITHOUT UPDATING USER'S XPUB IN THE DATABASE. IF THIS
// IS NOT DONE, THEN WE WILL CREATE THE WRONG DERIVATION PATH WHEN GETTING PRIVATE KEYS.
export const BASE_CASHU_LOCKING_DERIVATION_PATH = "m/129372'/0'/0'";

export type CashuCryptography = {
  getSeed: () => Promise<Uint8Array>;
  getXpub: (derivationPath?: string) => Promise<string>;
  getPrivateKey: (derivationPath?: string) => Promise<string>;
};

const seedDerivationPath = getSeedPhraseDerivationPath('cashu', 12);

function getCurrencyAndUnitFromToken(token: Token): {
  currency: Currency;
  unit: CurrencyUnit;
  formatUnit: 'sat' | 'usd';
} {
  if (token.unit === 'sat') {
    return { currency: 'BTC', unit: 'sat', formatUnit: 'sat' };
  }
  if (token.unit === 'usd') {
    return { currency: 'USD', unit: 'cent', formatUnit: 'usd' };
  }
  throw new Error(`Invalid token unit ${token.unit}`);
}

export function tokenToMoney(token: Token): Money {
  const { currency, unit } = getCurrencyAndUnitFromToken(token);
  const amount = sumProofs(token.proofs);
  return new Money({
    amount,
    currency,
    unit,
  });
}

export function getTokenHash(token: Token | string): Promise<string> {
  if (typeof token === 'string') {
    return computeSHA256(token);
  }
  // Deep-clone proofs before encoding to prevent getEncodedToken from
  // mutating proof.id (it truncates v2 keyset IDs to their short form).
  // TODO: remove this workaround after upgrading to cashu-ts v4+ (fix merged in cashu-ts#536, unreleased as of v3.6.1)
  const cloned: Token = {
    ...token,
    proofs: token.proofs.map((p) => ({ ...p })),
  };
  return computeSHA256(getEncodedToken(cloned));
}

/**
 * Gets Cashu cryptography functions using abstract KeyProvider and Cache.
 * @param keyProvider - Provider for cryptographic key operations.
 * @param cache - Cache for query deduplication/caching.
 * @returns The Cashu cryptography functions.
 */
export function getCashuCryptography(
  keyProvider: KeyProvider,
  cache: Cache,
): CashuCryptography {
  return {
    getSeed: () =>
      cache.fetchQuery({
        queryKey: ['cashu-seed'],
        queryFn: async () => {
          const response = await keyProvider.getMnemonic({
            seed_phrase_derivation_path: seedDerivationPath,
          });
          return mnemonicToSeedSync(response.mnemonic);
        },
        staleTime: Number.POSITIVE_INFINITY,
      }),
    getXpub: (derivationPath?: string) =>
      cache.fetchQuery({
        queryKey: ['cashu-xpub', derivationPath],
        queryFn: async () => {
          const seed = await cache.fetchQuery({
            queryKey: ['cashu-seed'],
            queryFn: async () => {
              const response = await keyProvider.getMnemonic({
                seed_phrase_derivation_path: seedDerivationPath,
              });
              return mnemonicToSeedSync(response.mnemonic);
            },
            staleTime: Number.POSITIVE_INFINITY,
          });
          const hdKey = HDKey.fromMasterSeed(seed);

          if (derivationPath) {
            const childKey = hdKey.derive(derivationPath);
            return childKey.publicExtendedKey;
          }

          return hdKey.publicExtendedKey;
        },
        staleTime: Number.POSITIVE_INFINITY,
      }),
    getPrivateKey: (derivationPath?: string) =>
      cache.fetchQuery({
        queryKey: ['cashu-private-key', derivationPath],
        queryFn: async () => {
          const response = await keyProvider.getPrivateKeyBytes({
            seed_phrase_derivation_path: seedDerivationPath,
            private_key_derivation_path: derivationPath,
          });
          return response.private_key;
        },
        staleTime: Number.POSITIVE_INFINITY,
      }),
  };
}

export const mintInfoQueryKey = (mintUrl: string) => ['mint-info', mintUrl];
export const allMintKeysetsQueryKey = (mintUrl: string) => [
  'all-mint-keysets',
  mintUrl,
];
export const mintKeysQueryKey = (mintUrl: string, keysetId?: string) => [
  'mint-keys',
  mintUrl,
  keysetId,
];

/**
 * Initializes a Cashu wallet with offline handling.
 * If the mint is offline or times out, returns a minimal wallet with isOnline: false.
 * @param cache - The cache to use for fetching mint data.
 * @param mintUrl - The mint URL.
 * @param currency - The currency.
 * @param bip39seed - Optional BIP39 seed for wallet initialization.
 * @returns The wallet and online status.
 */
export async function getInitializedCashuWallet(
  cache: Cache,
  mintUrl: string,
  currency: Currency,
  bip39seed?: Uint8Array,
): Promise<{ wallet: ExtendedCashuWallet; isOnline: boolean }> {
  return measureOperation(
    'getInitializedCashuWallet',
    async () => {
      let mintInfo: ExtendedMintInfo;
      let allMintKeysets: GetKeysetsResponse;
      let mintActiveKeys: GetKeysResponse;

      try {
        [mintInfo, allMintKeysets, mintActiveKeys] = await Promise.race([
          Promise.all([
            cache.fetchQuery({
              queryKey: mintInfoQueryKey(mintUrl),
              queryFn: async () =>
                new ExtendedMintInfo(await new Mint(mintUrl).getInfo()),
              staleTime: 1000 * 60 * 60,
            }),
            cache.fetchQuery({
              queryKey: allMintKeysetsQueryKey(mintUrl),
              queryFn: async () => new Mint(mintUrl).getKeySets(),
              staleTime: 1000 * 60 * 60,
            }),
            cache.fetchQuery({
              queryKey: mintKeysQueryKey(mintUrl),
              queryFn: async () => new Mint(mintUrl).getKeys(),
              staleTime: 1000 * 60 * 60,
            }),
          ]),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              cache.cancelQueries?.({
                queryKey: mintInfoQueryKey(mintUrl),
              });
              cache.cancelQueries?.({
                queryKey: allMintKeysetsQueryKey(mintUrl),
              });
              cache.cancelQueries?.({
                queryKey: mintKeysQueryKey(mintUrl),
              });
              reject(new NetworkError('Mint request timed out'));
            }, 10_000);
          }),
        ]);
      } catch (error) {
        if (error instanceof NetworkError) {
          const wallet = getCashuWallet(mintUrl, {
            unit: getCashuUnit(currency),
            bip39seed: bip39seed ?? undefined,
          });
          return { wallet, isOnline: false };
        }
        throw error;
      }

      const unitKeysets = allMintKeysets.keysets.filter(
        (ks) => ks.unit === getCashuProtocolUnit(currency),
      );
      const activeKeyset = unitKeysets.find((ks) => ks.active);

      if (!activeKeyset) {
        throw new Error(`No active keyset found for ${currency} on ${mintUrl}`);
      }

      const activeKeysForUnit = mintActiveKeys.keysets.find(
        (ks) => ks.id === activeKeyset.id,
      );

      if (!activeKeysForUnit) {
        throw new Error(
          `Got active keyset ${activeKeyset.id} from ${mintUrl} but could not find keys for it`,
        );
      }

      const wallet = getCashuWallet(mintUrl, {
        unit: getCashuUnit(currency),
        bip39seed: bip39seed ?? undefined,
      });
      const keyChainCache = KeyChain.mintToCacheDTO(
        wallet.unit,
        mintUrl,
        unitKeysets,
        [activeKeysForUnit],
      );
      wallet.loadMintFromCache(mintInfo.cache, keyChainCache);

      return { wallet, isOnline: true };
    },
    { mintUrl, currency },
  );
}
