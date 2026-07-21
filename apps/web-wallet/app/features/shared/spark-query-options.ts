import { getSparkMnemonic } from '@agicash/wallet-sdk/temporary';
import { queryOptions } from '@tanstack/react-query';

export const sparkMnemonicQueryOptions = () =>
  queryOptions({
    queryKey: ['spark-mnemonic'],
    queryFn: () => getSparkMnemonic(),
    staleTime: Number.POSITIVE_INFINITY,
  });
