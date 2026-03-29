import {
  getPrivateKey as getMnemonic,
  getPrivateKeyBytes,
} from '@agicash/opensecret';
import { getSeedPhraseDerivationPath } from '@agicash/sdk/features/accounts/account-cryptography';
import {
  getCashuCryptography as getCashuCryptographyCore,
  type CashuCryptography,
} from '@agicash/sdk/features/shared/cashu';
import type { KeyProvider } from '@agicash/sdk/interfaces/key-provider';
import { Mint, type Token, getDecodedToken } from '@cashu/cashu-ts';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import {
  type QueryClient,
  queryOptions,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { getQueryClient } from '~/features/shared/query-client';
import { queryClientAsCache } from '~/lib/cache-adapter';
import {
  ExtendedMintInfo,
  checkIsTestMint,
  extractCashuToken,
} from '~/lib/cashu';
import {
  MintBlocklistSchema,
  buildMintValidator,
} from '@agicash/sdk/lib/cashu/mint-validation';

import {
  getInitializedCashuWallet as getInitializedCashuWalletCore,
} from '@agicash/sdk/features/shared/cashu';
import type { Currency } from '@agicash/sdk/lib/money/index';

// Re-export from SDK
export {
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  type CashuCryptography,
  getTokenHash,
  tokenToMoney,
  mintInfoQueryKey,
  allMintKeysetsQueryKey,
  mintKeysQueryKey,
} from '@agicash/sdk/features/shared/cashu';

/**
 * Creates a web KeyProvider from @agicash/opensecret functions.
 */
function createWebKeyProvider(): KeyProvider {
  return {
    getPrivateKeyBytes: (params) => getPrivateKeyBytes(params),
    getPublicKey: (_type, _params) => {
      throw new Error('getPublicKey not implemented in web KeyProvider');
    },
    getMnemonic: (params) => getMnemonic(params),
  };
}

/**
 * Gets Cashu cryptography functions (web adapter).
 * Wraps QueryClient as Cache and uses @agicash/opensecret as KeyProvider.
 * @param queryClient - The TanStack QueryClient.
 * @returns The Cashu cryptography functions.
 */
export function getCashuCryptography(
  queryClient: QueryClient,
): CashuCryptography {
  const webKeyProvider = createWebKeyProvider();
  const cache = queryClientAsCache(queryClient);
  return getCashuCryptographyCore(webKeyProvider, cache);
}

/**
 * Initializes a Cashu wallet with offline handling (web adapter).
 * Wraps QueryClient as Cache before delegating to SDK.
 */
export function getInitializedCashuWallet(
  queryClient: QueryClient,
  mintUrl: string,
  currency: Currency,
  bip39seed?: Uint8Array,
) {
  const cache = queryClientAsCache(queryClient);
  return getInitializedCashuWalletCore(cache, mintUrl, currency, bip39seed);
}

// --- Web-only query options ---

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

const privateKeyQueryOptions = ({
  derivationPath,
}: { derivationPath?: string } = {}) =>
  queryOptions({
    queryKey: ['cashu-private-key', derivationPath],
    queryFn: async () => {
      const response = await getPrivateKeyBytes({
        seed_phrase_derivation_path: seedDerivationPath,
        private_key_derivation_path: derivationPath,
      });
      return response.private_key;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

const mintBlocklist = MintBlocklistSchema.parse(
  JSON.parse(import.meta.env.VITE_CASHU_MINT_BLOCKLIST ?? '[]'),
);

export const cashuMintValidator = buildMintValidator({
  requiredNuts: [4, 5, 7, 8, 9, 10, 11, 12, 17, 20] as const,
  requiredWebSocketCommands: ['bolt11_melt_quote', 'proof_state'] as const,
  blocklist: mintBlocklist,
});

/**
 * Get the mint info.
 */
export const mintInfoQueryOptions = (mintUrl: string) =>
  queryOptions({
    queryKey: ['mint-info', mintUrl],
    queryFn: async () =>
      new ExtendedMintInfo(await new Mint(mintUrl).getInfo()),
    staleTime: 1000 * 60 * 60, // 1 hour
  });

/**
 * Get the mints keysets in no specific order.
 */
export const allMintKeysetsQueryOptions = (mintUrl: string) =>
  queryOptions({
    queryKey: ['all-mint-keysets', mintUrl],
    queryFn: async () => new Mint(mintUrl).getKeySets(),
    staleTime: 1000 * 60 * 60, // 1 hour
  });

/**
 * Extract and decode a cashu token from arbitrary content.
 * Fetches keyset IDs from the token's mint for v2 keyset resolution.
 */
export async function decodeCashuToken(content: string): Promise<Token | null> {
  const result = extractCashuToken(content);
  if (!result) return null;

  try {
    const queryClient = getQueryClient();
    const data = await queryClient.fetchQuery(
      allMintKeysetsQueryOptions(result.metadata.mint),
    );
    const keysetIds = data.keysets.map((k) => k.id);
    return getDecodedToken(result.encoded, keysetIds);
  } catch (error) {
    console.error('Failed to decode cashu token', error);
    return null;
  }
}

/**
 * Get the mints public keys.
 */
export const mintKeysQueryOptions = (mintUrl: string, keysetId?: string) =>
  queryOptions({
    queryKey: ['mint-keys', mintUrl, keysetId],
    queryFn: async () => new Mint(mintUrl).getKeys(keysetId),
    staleTime: 1000 * 60 * 60, // 1 hour
  });

export const isTestMintQueryOptions = (mintUrl: string) =>
  queryOptions({
    queryKey: ['is-test-mint', mintUrl],
    queryFn: async () => checkIsTestMint(mintUrl),
    staleTime: Number.POSITIVE_INFINITY,
  });

/**
 * Hook that provides the Cashu cryptography functions.
 * Reference of the returned data is stable and doesn't change between renders.
 * @returns The Cashu cryptography functions.
 */
export function useCashuCryptography(): CashuCryptography {
  const queryClient = useQueryClient();

  return useMemo(
    () => getCashuCryptography(queryClient),
    [queryClient],
  );
}
