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
import type { AgicashDbTransaction } from '~/features/agicash-db/database';
import { useLatest } from '~/lib/use-latest';
import { useGetCashuAccount } from '../accounts/account-hooks';
import { useCashuSendSwapRepository } from '../send/cashu-send-swap-repository';
import { useCashuSendSwapService } from '../send/cashu-send-swap-service';
import { NotFoundError } from '../shared/error';
import { useUser } from '../user/user-hooks';
import type { Transaction } from './transaction';
import {
  type Cursor,
  useTransactionRepository,
} from './transaction-repository';

/**
 * Cache that manages transaction data and acknowledgment counts.
 */
class TransactionsCache {
  public static Key = 'transactions';
  public static AllTransactionsKey = 'all-transactions';
  public static UnacknowledgedCountKey = 'unacknowledged-transactions-count';

  constructor(private readonly queryClient: QueryClient) {}

  /**
   * Adds a new transaction or updates an existing transaction in the individual transaction cache.
   * Only updates when the incoming version is higher than the cached version, to avoid
   * overwriting newer data with older in case of out-of-order events.
   *
   * @param transaction - The transaction to add or update.
   * @param options.trackAcknowledgment - Whether to adjust the unacknowledged count based on
   * acknowledgment status transitions. Defaults to true.
   * @param options.previousAcknowledgmentStatus - The previous acknowledgment status from the DB.
   * Falls back to the cached value when not provided. Will be ignored if trackAcknowledgment is false.
   */
  upsert(
    transaction: Transaction,
    options?: {
      previousAcknowledgmentStatus?: Transaction['acknowledgmentStatus'];
      trackAcknowledgment?: boolean;
    },
  ) {
    const { previousAcknowledgmentStatus, trackAcknowledgment = true } =
      options ?? {};

    this.queryClient.setQueryData<Transaction>(
      [TransactionsCache.Key, transaction.id],
      (curr) => {
        if (curr && transaction.version <= curr.version) {
          return undefined;
        }

        if (trackAcknowledgment) {
          const prevAck =
            previousAcknowledgmentStatus !== undefined
              ? previousAcknowledgmentStatus
              : curr?.acknowledgmentStatus;
          const newAck = transaction.acknowledgmentStatus;

          if (prevAck == null && newAck === 'pending') {
            this.incrementUnacknowledgedCount();
          } else if (prevAck === 'pending' && newAck === 'acknowledged') {
            this.decrementUnacknowledgedCount();
          }
        }

        return transaction;
      },
    );
  }

  /**
   * Invalidates all transaction caches.
   */
  invalidate() {
    return Promise.all([
      this.queryClient.invalidateQueries({
        queryKey: [TransactionsCache.Key],
      }),
      this.queryClient.invalidateQueries({
        queryKey: [TransactionsCache.AllTransactionsKey],
      }),
      this.queryClient.invalidateQueries({
        queryKey: [TransactionsCache.UnacknowledgedCountKey],
      }),
    ]);
  }

  private incrementUnacknowledgedCount() {
    const currentCount = this.getUnacknowledgedCount();
    this.setUnacknowledgedCount(currentCount + 1);
  }

  private decrementUnacknowledgedCount() {
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
}

export function useTransactionsCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new TransactionsCache(queryClient), [queryClient]);
}

export function useTransaction(id: string) {
  const transactionRepository = useTransactionRepository();

  return useSuspenseQuery({
    queryKey: [TransactionsCache.Key, id],
    queryFn: async () => {
      const transaction = await transactionRepository.get(id);

      if (!transaction) {
        throw new NotFoundError(`Transaction not found for id: ${id}`);
      }

      return transaction;
    },
    retry: (failureCount, error) => {
      if (error instanceof NotFoundError) {
        return false;
      }
      return failureCount <= 3;
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
}

const PAGE_SIZE = 25;

export function useTransactions(accountId?: string) {
  const userId = useUser((user) => user.id);
  const transactionRepository = useTransactionRepository();
  const transactionsCache = useTransactionsCache();

  const result = useInfiniteQuery({
    queryKey: [TransactionsCache.AllTransactionsKey, accountId],
    initialPageParam: null,
    queryFn: async ({ pageParam }: { pageParam: Cursor | null }) => {
      const result = await transactionRepository.list({
        userId,
        cursor: pageParam,
        pageSize: PAGE_SIZE,
        accountId,
      });

      for (const transaction of result.transactions) {
        transactionsCache.upsert(transaction, { trackAcknowledgment: false });
      }

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
  // Update all transaction query caches (both unified and account-specific)
  const queries = queryClient.getQueriesData<
    InfiniteData<{
      transactions: Transaction[];
      nextCursor: Cursor | null;
    }>
  >({ queryKey: [TransactionsCache.AllTransactionsKey] });

  queries.forEach(([queryKey, data]) => {
    if (!data) return;

    queryClient.setQueryData(queryKey, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        transactions: page.transactions.map((tx) =>
          tx.id === transaction.id && tx.acknowledgmentStatus === 'pending'
            ? { ...tx, acknowledgmentStatus: 'acknowledged' }
            : tx,
        ),
      })),
    });
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
  const getCashuAccount = useGetCashuAccount();
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
        const account = getCashuAccount(swap.accountId);
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
export function useTransactionChangeHandlers() {
  const transactionRepository = useTransactionRepository();
  const transactionsCache = useTransactionsCache();

  return [
    {
      event: 'TRANSACTION_CREATED',
      handleEvent: async (payload: AgicashDbTransaction) => {
        const transaction = await transactionRepository.toTransaction(payload);
        transactionsCache.upsert(transaction);
      },
    },
    {
      event: 'TRANSACTION_UPDATED',
      handleEvent: async (
        payload: AgicashDbTransaction & {
          previous_acknowledgment_status: Transaction['acknowledgmentStatus'];
        },
      ) => {
        const transaction = await transactionRepository.toTransaction(payload);
        transactionsCache.upsert(transaction, {
          previousAcknowledgmentStatus: payload.previous_acknowledgment_status,
        });
      },
    },
  ];
}
