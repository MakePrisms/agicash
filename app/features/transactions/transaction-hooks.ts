import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  type AgicashDbTransaction,
  agicashDb,
} from '~/features/agicash-db/database';
import { useSupabaseRealtimeSubscription } from '~/lib/supabase/supabase-realtime';
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

const transactionQueryKey = 'transaction';
const allTransactionsQueryKey = 'all-transactions';
const unacknowledgedTransactionsCountQueryKey =
  'unacknowledged-transactions-count';

/**
 * Cache that manages transaction data and acknowledgment counts.
 */
export class TransactionsCache {
  constructor(private readonly queryClient: QueryClient) {}

  /**
   * Update a transaction in the individual transaction cache.
   * @param transaction - The updated transaction.
   */
  update(transaction: Transaction) {
    this.handleAcknowledgmentStatusChange(transaction);

    this.queryClient.setQueryData<Transaction>(
      [transactionQueryKey, transaction.id],
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
      [transactionQueryKey, transaction.id],
      transaction,
    );
  }

  private handleAcknowledgmentStatusChange(newTransaction: Transaction) {
    const oldTransaction = this.queryClient.getQueryData<Transaction>([
      transactionQueryKey,
      newTransaction.id,
    ]);

    const oldStatus = oldTransaction?.acknowledgmentStatus;
    const newStatus = newTransaction.acknowledgmentStatus;

    if (oldStatus !== 'pending' && newStatus === 'pending') {
      this.incrementUnacknowledgedCount();
    } else if (oldStatus === 'pending' && newStatus === 'acknowledged') {
      this.decrementUnacknowledgedCount();
    }
  }

  private getUnacknowledgedCount(): number {
    return (
      this.queryClient.getQueryData<number>([
        unacknowledgedTransactionsCountQueryKey,
      ]) ?? 0
    );
  }

  private setUnacknowledgedCount(count: number) {
    this.queryClient.setQueryData<number>(
      [unacknowledgedTransactionsCountQueryKey],
      Math.max(0, count), // Ensure count never goes negative
    );
  }

  private incrementUnacknowledgedCount() {
    const currentCount = this.getUnacknowledgedCount();
    this.setUnacknowledgedCount(currentCount + 1);
  }

  private decrementUnacknowledgedCount() {
    const currentCount = this.getUnacknowledgedCount();
    this.setUnacknowledgedCount(currentCount - 1);
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
    queryKey: [transactionQueryKey, transactionId],
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
    queryKey: [transactionQueryKey, id],
    queryFn: () => transactionRepository.get(id),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
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
    queryKey: [unacknowledgedTransactionsCountQueryKey],
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

function useOnTransactionChange({
  onCreated,
  onUpdated,
}: {
  onCreated: (transaction: Transaction) => void;
  onUpdated: (transaction: Transaction) => void;
}) {
  const transactionRepository = useTransactionRepository();
  const onCreatedRef = useLatest(onCreated);
  const onUpdatedRef = useLatest(onUpdated);
  const queryClient = useQueryClient();

  return useSupabaseRealtimeSubscription({
    channelFactory: () =>
      agicashDb.channel('transactions').on(
        'postgres_changes',
        {
          event: '*',
          schema: 'wallet',
          table: 'transactions',
        },
        async (
          payload: RealtimePostgresChangesPayload<AgicashDbTransaction>,
        ) => {
          if (payload.eventType === 'INSERT') {
            const addedTransaction = await transactionRepository.toTransaction(
              payload.new,
            );
            onCreatedRef.current(addedTransaction);
          } else if (payload.eventType === 'UPDATE') {
            const updatedTransaction =
              await transactionRepository.toTransaction(payload.new);

            onUpdatedRef.current(updatedTransaction);
          }
        },
      ),
    onConnected: () => {
      // Invalidate the transaction count query so it's re-fetched and the cache is updated.
      // This is needed to get any data that might have been updated while the re-connection was in progress.
      queryClient.invalidateQueries({
        queryKey: [unacknowledgedTransactionsCountQueryKey],
      });
    },
  });
}

/**
 * Hook that sets up realtime tracking for all transactions.
 * This should be called once at the app level to ensure all transaction changes are tracked.
 */
export function useTrackTransactions() {
  const transactionsCache = useTransactionsCache();

  return useOnTransactionChange({
    onCreated: (transaction) => {
      transactionsCache.add(transaction);
    },
    onUpdated: (transaction) => {
      transactionsCache.update(transaction);
    },
  });
}
