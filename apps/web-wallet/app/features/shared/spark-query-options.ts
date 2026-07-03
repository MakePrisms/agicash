import type { SparkNetwork } from '@agicash/wallet-sdk';
import {
  getSparkIdentityPublicKeyFromMnemonic,
  getSparkMnemonic,
} from '@agicash/wallet-sdk/temporary';
import { type QueryClient, queryOptions } from '@tanstack/react-query';

export const sparkMnemonicQueryOptions = () =>
  queryOptions({
    queryKey: ['spark-mnemonic'],
    queryFn: () => getSparkMnemonic(),
    staleTime: Number.POSITIVE_INFINITY,
  });

export const sparkIdentityPublicKeyQueryOptions = ({
  queryClient,
  network,
}: { queryClient: QueryClient; network: SparkNetwork }) =>
  queryOptions({
    queryKey: ['spark-identity-public-key'],
    queryFn: async () =>
      getSparkIdentityPublicKeyFromMnemonic(
        await queryClient.fetchQuery(sparkMnemonicQueryOptions()),
        network.toLowerCase() as 'mainnet' | 'regtest',
      ),
  });
