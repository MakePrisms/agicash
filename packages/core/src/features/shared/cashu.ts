import {
  CashuMint,
  type MintActiveKeys,
  type MintAllKeysets,
  NetworkError,
  type Token,
  getEncodedToken,
} from '@cashu/cashu-ts';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { getConfig } from '../../config';
import type { Cache } from '../../interfaces/cache';
import type { KeyProvider } from '../../interfaces/key-provider';
import {
  type ExtendedCashuWallet,
  type MintInfo,
  getCashuProtocolUnit,
  getCashuUnit,
  getCashuWallet,
  sumProofs,
} from '../../lib/cashu';
import { buildMintValidator } from '../../lib/cashu/mint-validation';
import type { CashuProtocolUnit } from '../../lib/cashu/types';
import { type Currency, type CurrencyUnit, Money } from '../../lib/money';
import { computeSHA256 } from '../../lib/sha256';
import { measureOperation } from '../../performance';
import { getSeedPhraseDerivationPath } from '../accounts/account-cryptography';

// Cashu-specific derivation path with hardnened indexes to derive public keys for
// locking mint quotes and proofs. 129372 is UTF-8 for 🥜 (see NUT-13) and the other
// 2 indexes are the coin type (0) and account (0) which can be changed to derive
// different keys if needed. This path is "proprietary" and not part of any standard.
// The index values are unimportant as long as they are hardened and remain constant.
// DO NOT CHANGE THIS VALUE WITHOUT UPDATING USER'S XPUB IN THE DATABASE. IF THIS
// IS NOT DONE, THEN WE WILL CREATE THE WRONG DERIVATION PATH WHEN GETTING PRIVATE KEYS.
export const BASE_CASHU_LOCKING_DERIVATION_PATH = "m/129372'/0'/0'";

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
  return new Money<Currency>({
    amount,
    currency,
    unit,
  });
}

export type CashuCryptography = {
  getSeed: () => Promise<Uint8Array>;
  getXpub: (derivationPath?: string) => Promise<string>;
  getPrivateKey: (derivationPath?: string) => Promise<string>;
};

const seedDerivationPath = getSeedPhraseDerivationPath('cashu', 12);

/**
 * Gets Cashu cryptography functions.
 * @param keyProvider - Provides cryptographic key material
 * @param cache - Cache for memoizing expensive key derivations
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

export function getTokenHash(token: Token | string): Promise<string> {
  const encodedToken =
    typeof token === 'string' ? token : getEncodedToken(token);
  return computeSHA256(encodedToken);
}

/**
 * Creates a cashu mint validator using the blocklist from config.
 * Call this after configure() has been called.
 */
export function createCashuMintValidator() {
  return buildMintValidator({
    requiredNuts: [4, 5, 7, 8, 9, 10, 11, 12, 17, 20] as const,
    requiredWebSocketCommands: ['bolt11_melt_quote', 'proof_state'] as const,
    blocklist: getConfig().cashuMintBlocklist as {
      mintUrl: string;
      unit: CashuProtocolUnit | null;
    }[],
  });
}

let _cashuMintValidator: ReturnType<typeof createCashuMintValidator> | null =
  null;

/**
 * Lazy cashu mint validator instance. Created on first use.
 * Call configure() before first use.
 */
export const cashuMintValidator: ReturnType<typeof createCashuMintValidator> = (
  ...args
) => {
  if (!_cashuMintValidator) {
    _cashuMintValidator = createCashuMintValidator();
  }
  return _cashuMintValidator(...args);
};

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
      let mintInfo: MintInfo;
      let allMintKeysets: MintAllKeysets;
      let mintActiveKeys: MintActiveKeys;

      const mintInfoQueryKey = ['mint-info', mintUrl];
      const allMintKeysetsQueryKey = ['all-mint-keysets', mintUrl];
      const mintKeysQueryKey = ['mint-keys', mintUrl, undefined];

      try {
        [mintInfo, allMintKeysets, mintActiveKeys] = await Promise.race([
          Promise.all([
            cache.fetchQuery({
              queryKey: mintInfoQueryKey,
              queryFn: async () => getCashuWallet(mintUrl).getMintInfo(),
              staleTime: 1000 * 60 * 60, // 1 hour
            }),
            cache.fetchQuery({
              queryKey: allMintKeysetsQueryKey,
              queryFn: async () => CashuMint.getKeySets(mintUrl),
              staleTime: 1000 * 60 * 60, // 1 hour
            }),
            cache.fetchQuery({
              queryKey: mintKeysQueryKey,
              queryFn: async () => CashuMint.getKeys(mintUrl),
              staleTime: 1000 * 60 * 60, // 1 hour
            }),
          ]),
          new Promise<never>((_, reject) => {
            setTimeout(async () => {
              if (cache.cancelQueries) {
                await Promise.all([
                  cache.cancelQueries({ queryKey: mintInfoQueryKey }),
                  cache.cancelQueries({ queryKey: allMintKeysetsQueryKey }),
                  cache.cancelQueries({ queryKey: mintKeysQueryKey }),
                ]);
              }
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
        mintInfo,
        keys: activeKeysForUnit,
        keysets: unitKeysets,
      });

      // The constructor does not set the keysetId, so we need to set it manually
      wallet.keysetId = activeKeyset.id;

      return { wallet, isOnline: true };
    },
    { mintUrl, currency },
  );
}
