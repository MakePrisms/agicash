import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { getSdk } from '~/features/shared/sdk';
import { useLatest } from '~/lib/use-latest';
import { type Transaction, isTransactionReversable } from './transaction';

export { isTransactionReversable };

/**
 * Hook that provides the transactions cache.
 *
 * Transitional (sdk.transactions.internal): only for the not-yet-migrated
 * receive/send domain code and the web-owned realtime infrastructure.
 * App/UI code must use the curated sdk.transactions methods.
 */
export function useTransactionsCache() {
  return getSdk().transactions.internal.cache;
}

export function useTransaction(id: string) {
  return useSuspenseQuery({
    ...getSdk().transactions.queryOptions(id),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
}

export function useTransactions(accountId?: string) {
  return useInfiniteQuery({
    ...getSdk().transactions.listOptions(accountId),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: 1,
  });
}

export function useHasTransactionsPendingAck() {
  const result = useQuery({
    ...getSdk().transactions.pendingAckCountOptions(),
    select: (data) => data > 0,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: 1,
  });

  return result.data ?? false;
}

export function useAcknowledgeTransaction() {
  return useMutation({
    mutationFn: ({ transaction }: { transaction: Transaction }) =>
      getSdk().transactions.acknowledge(transaction),
    retry: 1,
  });
}

/**
 * Hook to reverse a transaction before it has been completed.
 * Transactions that can be reversed are:
 * - CASHU_TOKEN sends that are in the PENDING state
 * @returns a mutation to reverse a transaction
 * @throws an error if the transaction cannot be reversed based on the type and state of the transaction
 */
export function useReverseTransaction({
  onSuccess,
  onError,
}: {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}) {
  const onSuccessRef = useLatest(onSuccess);
  const onErrorRef = useLatest(onError);

  return useMutation({
    mutationFn: ({ transaction }: { transaction: Transaction }) =>
      getSdk().send.reverseTransaction(transaction),
    onSuccess: () => {
      onSuccessRef.current?.();
    },
    onError: (error) => {
      onErrorRef.current?.(error);
    },
  });
}
