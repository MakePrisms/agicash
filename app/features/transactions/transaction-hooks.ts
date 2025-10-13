import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import type { AgicashDbTransaction } from '~/features/agicash-db/database';
import { useLatest } from '~/lib/use-latest';
import { useGetLatestCashuAccount } from '../accounts/account-hooks';
import { useCashuSendSwapRepository } from '../send/cashu-send-swap-repository';
import { useCashuSendSwapService } from '../send/cashu-send-swap-service';
import { useUser } from '../user/user-hooks';
import type { Transaction } from './transaction';
import {
  type Cursor,
  useTransactionRepository,
} from './transaction-repository';

const allTransactionsQueryKey = 'all-transactions';

/**
 * Cache that manages transaction data and acknowledgment counts.
 */
class TransactionsCache {
  public static Key = 'transactions';
  public static UnacknowledgedCountKey = 'unacknowledged-transactions-count';

  constructor(private readonly queryClient: QueryClient) {}

  /**
   * Update a transaction in the individual transaction cache.
   * @param transaction - The updated transaction.
   */
  update(transaction: Transaction) {
    this.queryClient.setQueryData<Transaction>(
      [TransactionsCache.Key, transaction.id],
      transaction,
    );
  }

  /**
   * Add a new transaction to the individual transaction cache.
   * @param transaction - The new transaction to add.
   */
  add(transaction: Transaction) {
    if (transaction.acknowledgmentStatus === 'pending') {
      this.incrementUnacknowledgedCount();
    }

    this.queryClient.setQueryData<Transaction>(
      [TransactionsCache.Key, transaction.id],
      transaction,
    );
  }

  incrementUnacknowledgedCount() {
    const currentCount = this.getUnacknowledgedCount();
    this.setUnacknowledgedCount(currentCount + 1);
  }

  decrementUnacknowledgedCount() {
    const currentCount = this.getUnacknowledgedCount();
    this.setUnacknowledgedCount(currentCount - 1);
  }

  private getUnacknowledgedCount(): number {
    return (
      this.queryClient.getQueryData<number>([
        TransactionsCache.UnacknowledgedCountKey,
      ]) ?? 0
    );
  }

  private setUnacknowledgedCount(count: number) {
    this.queryClient.setQueryData<number>(
      [TransactionsCache.UnacknowledgedCountKey],
      Math.max(0, count), // Ensure count never goes negative
    );
  }

  invalidate() {
    return Promise.all([
      this.queryClient.invalidateQueries({
        queryKey: [TransactionsCache.Key],
      }),
      this.queryClient.invalidateQueries({
        queryKey: [TransactionsCache.UnacknowledgedCountKey],
      }),
    ]);
  }
}

export function useTransactionsCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new TransactionsCache(queryClient), [queryClient]);
}

export function useTransaction({
  transactionId,
}: {
  transactionId?: string;
}) {
  const enabled = !!transactionId;
  const transactionRepository = useTransactionRepository();

  return useQuery({
    queryKey: [TransactionsCache.Key, transactionId],
    queryFn: () => transactionRepository.get(transactionId ?? ''),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
}

export function useSuspenseTransaction(id: string) {
  const transactionRepository = useTransactionRepository();

  return useSuspenseQuery({
    queryKey: [TransactionsCache.Key, id],
    queryFn: () => transactionRepository.get(id),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
}

type UseTrackTransactionProps = {
  transactionId?: string;
  onDraft?: (transaction: Transaction) => void;
  onPending?: (transaction: Transaction) => void;
  onCompleted?: (transaction: Transaction) => void;
  onFailed?: (transaction: Transaction) => void;
  onReversed?: (transaction: Transaction) => void;
};

type UseTrackTransactionResponse =
  | { status: 'DISABLED' }
  | { status: 'LOADING' }
  | { status: Transaction['state']; transaction: Transaction };

/**
 * Hook to track a transaction's state and trigger callbacks when the state changes.
 * @param transactionId - The ID of the transaction to track
 * @returns The current status of the transaction and the transaction data
 */
export function useTrackTransaction({
  transactionId = '',
  onDraft,
  onPending,
  onCompleted,
  onFailed,
  onReversed,
}: UseTrackTransactionProps): UseTrackTransactionResponse {
  const enabled = !!transactionId;
  const onDraftRef = useLatest(onDraft);
  const onPendingRef = useLatest(onPending);
  const onCompletedRef = useLatest(onCompleted);
  const onFailedRef = useLatest(onFailed);
  const onReversedRef = useLatest(onReversed);

  const { data } = useTransaction({ transactionId });

  useEffect(() => {
    if (!data) return;

    if (data.state === 'DRAFT') {
      onDraftRef.current?.(data);
    } else if (data.state === 'PENDING') {
      onPendingRef.current?.(data);
    } else if (data.state === 'COMPLETED') {
      onCompletedRef.current?.(data);
    } else if (data.state === 'FAILED') {
      onFailedRef.current?.(data);
    } else if (data.state === 'REVERSED') {
      onReversedRef.current?.(data);
    }
  }, [data]);

  if (!enabled) {
    return { status: 'DISABLED' };
  }

  if (!data) {
    return { status: 'LOADING' };
  }

  return {
    status: data.state,
    transaction: data,
  };
}

const PAGE_SIZE = 25;

export function useTransactions() {
  const userId = useUser((user) => user.id);
  const transactionRepository = useTransactionRepository();

  const result = useInfiniteQuery({
    queryKey: [allTransactionsQueryKey],
    initialPageParam: null,
    queryFn: async ({ pageParam }: { pageParam: Cursor | null }) => {
      const result = await transactionRepository.list({
        userId,
        cursor: pageParam,
        pageSize: PAGE_SIZE,
      });
      return {
        transactions: result.transactions,
        nextCursor:
          result.transactions.length === PAGE_SIZE ? result.nextCursor : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: 1,
  });

  return result;
}

export function useHasTransactionsPendingAck() {
  const transactionRepository = useTransactionRepository();
  const userId = useUser((user) => user.id);

  const result = useQuery({
    queryKey: [TransactionsCache.UnacknowledgedCountKey],
    queryFn: () =>
      transactionRepository.countTransactionsPendingAck({ userId }),
    select: (data) => data > 0,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: 1,
  });

  return result.data ?? false;
}

const acknowledgeTransactionInHistoryCache = (
  queryClient: QueryClient,
  transaction: Transaction,
) => {
  queryClient.setQueryData<
    InfiniteData<{
      transactions: Transaction[];
      nextCursor: Cursor | null;
    }>
  >([allTransactionsQueryKey], (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((page) => ({
        ...page,
        transactions: page.transactions.map((tx) =>
          tx.id === transaction.id && tx.acknowledgmentStatus === 'pending'
            ? { ...tx, acknowledgmentStatus: 'acknowledged' }
            : tx,
        ),
      })),
    };
  });
};

export function useAcknowledgeTransaction() {
  const transactionRepository = useTransactionRepository();
  const userId = useUser((user) => user.id);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ transaction }: { transaction: Transaction }) => {
      await transactionRepository.acknowledgeTransaction({
        userId,
        transactionId: transaction.id,
      });
    },
    onSuccess: (_, { transaction }) => {
      acknowledgeTransactionInHistoryCache(queryClient, transaction);
    },
    retry: 1,
  });
}

export function isTransactionReversable(transaction: Transaction) {
  return (
    transaction.state === 'PENDING' &&
    transaction.direction === 'SEND' &&
    transaction.type === 'CASHU_TOKEN'
  );
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
  const cashuSendSwapService = useCashuSendSwapService();
  const getLatestCashuAccount = useGetLatestCashuAccount();
  const cashuSendSwapRepository = useCashuSendSwapRepository();
  const onSuccessRef = useLatest(onSuccess);
  const onErrorRef = useLatest(onError);

  return useMutation({
    mutationFn: async ({ transaction }: { transaction: Transaction }) => {
      if (!isTransactionReversable(transaction)) {
        throw new Error('Transaction cannot be reversed');
      }

      if (transaction.type === 'CASHU_TOKEN') {
        const swap = await cashuSendSwapRepository.getByTransactionId(
          transaction.id,
        );
        if (!swap) {
          throw new Error(`Swap not found for transaction ${transaction.id}`);
        }
        const account = await getLatestCashuAccount(swap.accountId);
        await cashuSendSwapService.reverse(swap, account);
      } else {
        throw new Error('Only CASHU_TOKEN transactions can be reversed');
      }
    },
    onSuccess: () => {
      onSuccessRef.current?.();
    },
    onError: (error) => {
      onErrorRef.current?.(error);
    },
  });
}

/**
 * Hook that returns a transaction change handler.
 */
export function useTransactionChangeHandler() {
  const transactionRepository = useTransactionRepository();
  const transactionsCache = useTransactionsCache();

  return {
    table: 'transactions',
    onInsert: async (payload: AgicashDbTransaction) => {
      const addedTransaction =
        await transactionRepository.toTransaction(payload);
      transactionsCache.add(addedTransaction);
    },
    onUpdate: async (
      newPayload: AgicashDbTransaction,
      oldPayload: AgicashDbTransaction,
    ) => {
      const updatedTransaction =
        await transactionRepository.toTransaction(newPayload);

      transactionsCache.update(updatedTransaction);

      if (
        newPayload.acknowledgment_status !== oldPayload.acknowledgment_status
      ) {
        const newStatus = updatedTransaction.acknowledgmentStatus;
        const prevStatus = oldPayload.acknowledgment_status ?? null;

        if (prevStatus === null && newStatus === 'pending') {
          transactionsCache.incrementUnacknowledgedCount();
        } else if (prevStatus === 'pending' && newStatus === 'acknowledged') {
          transactionsCache.decrementUnacknowledgedCount();
        }
      }
    },
  };
}
