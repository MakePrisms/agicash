import { getSparkMnemonic } from '@agicash/wallet-sdk/temporary';
import { queryOptions } from '@tanstack/react-query';
import { derivedKeyQueryPrefix } from './session-key-queries';

export const sparkMnemonicQueryOptions = () =>
  queryOptions({
    queryKey: [derivedKeyQueryPrefix, 'spark-mnemonic'],
    queryFn: () => getSparkMnemonic(),
    staleTime: Number.POSITIVE_INFINITY,
  });
