import { getPrivateKey as getMnemonic } from '@opensecret/react';
import { mnemonicToSeedSync } from '@scure/bip39';
import {
  type QueryClient,
  queryOptions,
  useQueryClient,
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
