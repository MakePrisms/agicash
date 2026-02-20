import {
  type CashuCryptography,
  createCashuMintValidator,
  getCashuCryptography as getCashuCryptographyCore,
  getInitializedCashuWallet as getInitializedCashuWalletCore,
} from '@agicash/core/features/shared/cashu';
import type { Cache } from '@agicash/core/interfaces/cache';
import type { KeyProvider } from '@agicash/core/interfaces/key-provider';
import { CashuMint } from '@cashu/cashu-ts';
import {
  getPrivateKey as getMnemonic,
  getPrivateKeyBytes,
  getPublicKey,
} from '@opensecret/react';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import {
  type QueryClient,
  queryOptions,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { checkIsTestMint, getCashuWallet } from '~/lib/cashu';
import type { Currency } from '~/lib/money';
import { getSeedPhraseDerivationPath } from '../accounts/account-cryptography';

// Re-export core types/functions for backward compatibility
export {
  type CashuCryptography,
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  tokenToMoney,
  getTokenHash,
  createCashuMintValidator,
} from '@agicash/core/features/shared/cashu';

/**
 * Initializes a Cashu wallet with offline handling.
 * Wraps the core function to accept QueryClient (adapts to Cache interface).
 */
export async function getInitializedCashuWallet(
  queryClient: QueryClient,
  mintUrl: string,
  currency: Currency,
  bip39seed?: Uint8Array,
) {
  const cache: Cache = {
    fetchQuery: (opts) => queryClient.fetchQuery(opts),
    cancelQueries: (params) => queryClient.cancelQueries(params),
  };
  return getInitializedCashuWalletCore(cache, mintUrl, currency, bip39seed);
}

const seedDerivationPath = getSeedPhraseDerivationPath('cashu', 12);

export const seedQueryOptions = () =>
  queryOptions({
    queryKey: ['cashu-seed'],
    queryFn: async () => {
      const response = await getMnemonic({
        seed_phrase_derivation_path: seedDerivationPath,
      });
      return mnemonicToSeedSync(response.mnemonic);
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

export const xpubQueryOptions = ({
  queryClient,
  derivationPath,
}: { queryClient: QueryClient; derivationPath?: string }) =>
  queryOptions({
    queryKey: ['cashu-xpub', derivationPath],
    queryFn: async () => {
      const seed = await queryClient.fetchQuery(seedQueryOptions());
      const hdKey = HDKey.fromMasterSeed(seed);

      if (derivationPath) {
        const childKey = hdKey.derive(derivationPath);
        return childKey.publicExtendedKey;
      }

      return hdKey.publicExtendedKey;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

/**
 * Gets Cashu cryptography functions.
 * @deprecated Use getCashuCryptography from @agicash/core with KeyProvider and Cache instead
 * @returns The Cashu cryptography functions.
 */
export function getCashuCryptography(
  queryClient: QueryClient,
): CashuCryptography {
  const keyProvider: KeyProvider = {
    getPrivateKeyBytes,
    getPublicKey,
    getMnemonic,
  };
  const cache: Cache = {
    fetchQuery: (opts) => queryClient.fetchQuery(opts),
    cancelQueries: (params) => queryClient.cancelQueries(params),
  };
  return getCashuCryptographyCore(keyProvider, cache);
}

/**
 * Hook that provides the Cashu cryptography functions.
 * Reference of the returned data is stable and doesn't change between renders.
 * @returns The Cashu cryptography functions.
 */
export function useCashuCryptography(): CashuCryptography {
  const queryClient = useQueryClient();

  return useMemo(() => getCashuCryptography(queryClient), [queryClient]);
}

let _cashuMintValidator: ReturnType<typeof createCashuMintValidator> | null =
  null;

/**
 * The cashu mint validator instance, lazily created on first use.
 */
export const cashuMintValidator: ReturnType<typeof createCashuMintValidator> = (
  ...args
) => {
  if (!_cashuMintValidator) {
    _cashuMintValidator = createCashuMintValidator();
  }
  return _cashuMintValidator(...args);
};

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
 * Get the mint info.
 *
 * @param mintUrl
 * @returns The mint info.
 */
export const mintInfoQueryOptions = (mintUrl: string) =>
  queryOptions({
    queryKey: mintInfoQueryKey(mintUrl),
    queryFn: async () => getCashuWallet(mintUrl).getMintInfo(),
    staleTime: 1000 * 60 * 60, // 1 hour
  });

/**
 * Get the mints keysets in no specific order.
 *
 * @param mintUrl
 * @returns All the mints past and current keysets.
 */
export const allMintKeysetsQueryOptions = (mintUrl: string) =>
  queryOptions({
    queryKey: allMintKeysetsQueryKey(mintUrl),
    queryFn: async () => CashuMint.getKeySets(mintUrl),
    staleTime: 1000 * 60 * 60, // 1 hour
  });

/**
 * Get the mints public keys.
 *
 * @param mintUrl
 * @param keysetId Optional param to get the keys for a specific keyset. If not specified, the
 *   keys from all active keysets are fetched.
 * @returns An object with an array of the fetched keysets.
 */
export const mintKeysQueryOptions = (mintUrl: string, keysetId?: string) =>
  queryOptions({
    queryKey: mintKeysQueryKey(mintUrl, keysetId),
    queryFn: async () => CashuMint.getKeys(mintUrl, keysetId),
    staleTime: 1000 * 60 * 60, // 1 hour
  });

export const isTestMintQueryOptions = (mintUrl: string) =>
  queryOptions({
    queryKey: ['is-test-mint', mintUrl],
    queryFn: async () => checkIsTestMint(mintUrl),
    staleTime: Number.POSITIVE_INFINITY,
  });
