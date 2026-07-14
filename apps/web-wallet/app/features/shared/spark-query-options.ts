import { getInternalSessionKeys } from '@agicash/wallet-sdk/temporary';
import { queryOptions } from '@tanstack/react-query';

export const sparkMnemonicQueryOptions = () =>
  queryOptions({
    queryKey: ['spark-mnemonic'],
    queryFn: () => getInternalSessionKeys().getSparkMnemonic(),
    staleTime: Number.POSITIVE_INFINITY,
  });
