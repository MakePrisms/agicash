import {
  type CashuCryptography,
  deriveCashuXpub,
  getAllMintKeysets,
  getCashuPrivateKey,
  getInternalSessionKeys,
  getMintInfo,
} from '@agicash/wallet-sdk/temporary';
import { type QueryClient, queryOptions } from '@tanstack/react-query';

export const seedQueryOptions = () =>
  queryOptions({
    queryKey: ['cashu-seed'],
    queryFn: () => getInternalSessionKeys().getCashuSeed(),
    staleTime: Number.POSITIVE_INFINITY,
  });

export const xpubQueryOptions = ({
  queryClient,
  derivationPath,
}: { queryClient: QueryClient; derivationPath?: string }) =>
  queryOptions({
    queryKey: ['cashu-xpub', derivationPath],
    queryFn: async () =>
      deriveCashuXpub(
        await queryClient.fetchQuery(seedQueryOptions()),
        derivationPath,
      ),
    staleTime: Number.POSITIVE_INFINITY,
  });

const privateKeyQueryOptions = ({
  derivationPath,
}: { derivationPath?: string } = {}) =>
  queryOptions({
    queryKey: ['cashu-private-key', derivationPath],
    queryFn: () => getCashuPrivateKey(derivationPath),
    staleTime: Number.POSITIVE_INFINITY,
  });

/**
 * Builds the Cashu cryptography functions, memoizing each derivation in the
 * host's TanStack cache. The SDK exposes the raw (uncached) getters; caching is
 * the frontend's concern.
 */
export function getCashuCryptography(
  queryClient: QueryClient,
): CashuCryptography {
  return {
    getSeed: () => queryClient.fetchQuery(seedQueryOptions()),
    getXpub: (derivationPath?: string) =>
      queryClient.fetchQuery(xpubQueryOptions({ queryClient, derivationPath })),
    getPrivateKey: (derivationPath?: string) =>
      queryClient.fetchQuery(privateKeyQueryOptions({ derivationPath })),
  };
}

export const mintInfoQueryOptions = (mintUrl: string) =>
  queryOptions({
    queryKey: ['mint-info', mintUrl],
    queryFn: () => getMintInfo(mintUrl),
    staleTime: 1000 * 60 * 60, // 1 hour
  });

export const allMintKeysetsQueryOptions = (mintUrl: string) =>
  queryOptions({
    queryKey: ['all-mint-keysets', mintUrl],
    queryFn: () => getAllMintKeysets(mintUrl),
    staleTime: 1000 * 60 * 60, // 1 hour
  });
