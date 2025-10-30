import {
  type NetworkType as SparkNetwork,
  SparkWallet,
} from '@buildonspark/spark-sdk';
import { getPrivateKey as getMnemonic } from '@opensecret/react';
import { mnemonicToSeedSync } from '@scure/bip39';
import {
  type QueryClient,
  queryOptions,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { getSeedPhraseDerivationPath } from '../accounts/account-cryptography';
export type SparkCryptography = {
  getSeed: () => Promise<Uint8Array>;
};

const seedDerivationPath = getSeedPhraseDerivationPath('spark', 12);

export const seedQueryOptions = () =>
  queryOptions({
    queryKey: ['spark-seed'],
    queryFn: async () => {
      const response = await getMnemonic({
        seed_phrase_derivation_path: seedDerivationPath,
      });
      return mnemonicToSeedSync(response.mnemonic);
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

/**
 * Gets Spark cryptography functions.
 * @returns The Spark cryptography functions.
 */
export function getSparkCryptography(
  queryClient: QueryClient,
): SparkCryptography {
  return {
    getSeed: () => queryClient.fetchQuery(seedQueryOptions()),
  };
}

/**
 * Hook that provides the Spark cryptography functions.
 * Reference of the returned data is stable and doesn't change between renders.
 * @returns The Spark cryptography functions.
 */
export function useSparkCryptography(): SparkCryptography {
  const queryClient = useQueryClient();

  return useMemo(() => getSparkCryptography(queryClient), [queryClient]);
}

export const sparkWalletQueryOptions = (network: SparkNetwork) =>
  queryOptions({
    queryKey: ['spark-wallet', network],
    queryFn: async ({ client }) => {
      const seed = await client.fetchQuery(seedQueryOptions());
      const { wallet } = await SparkWallet.initialize({
        mnemonicOrSeed: seed,
        options: { network },
        accountNumber: 0,
      });
      return wallet;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

export function getSparkWalletFromCache(
  queryClient: QueryClient,
  network: SparkNetwork,
): SparkWallet | undefined {
  return queryClient.getQueryData<SparkWallet>(['spark-wallet', network]);
}

export function useSparkWallet(network: SparkNetwork = 'MAINNET'): SparkWallet {
  const { data: wallet } = useSuspenseQuery(sparkWalletQueryOptions(network));

  return wallet;
}
