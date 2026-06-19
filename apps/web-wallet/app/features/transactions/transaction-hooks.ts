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
import type { Cursor } from '@agicash/wallet-sdk';
import { getSdk } from '~/lib/sdk';
import { useLatest } from '~/lib/use-latest';
import { useGetCashuAccount } from '../accounts/account-hooks';
import { useCashuSendSwapRepository } from '../send/cashu-send-swap-repository';
import { useCashuSendSwapService } from '../send/cashu-send-swap-service';
import { NotFoundError } from '../shared/error';
import type { Transaction } from './transaction';

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
   * @param transaction - The transaction to add or update.
   */
  upsert(transaction: Transaction) {
    this.queryClient.setQueryData<Transaction>(
      [TransactionsCache.Key, transaction.id],
      (curr) =>
        !curr || transaction.version > curr.version ? transaction : undefined,
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

  /**
   * Invalidates a single transaction query by ID.
   */
  invalidateTransaction(transactionId: string) {
    return this.queryClient.invalidateQueries({
      queryKey: [TransactionsCache.Key, transactionId],
    });
  }

  /**
   * Invalidates the unacknowledged count query.
   */
  invalidateUnacknowledgedCount() {
    return this.queryClient.invalidateQueries({
      queryKey: [TransactionsCache.UnacknowledgedCountKey],
    });
  }
}

export function useTransactionsCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new TransactionsCache(queryClient), [queryClient]);
}

export function useTransaction(id: string) {
  return useSuspenseQuery({
    queryKey: [TransactionsCache.Key, id],
    queryFn: async () => {
      const transaction = await getSdk().transactions.get(id);

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
  const transactionsCache = useTransactionsCache();

  const result = useInfiniteQuery({
    queryKey: [TransactionsCache.AllTransactionsKey, accountId],
    initialPageParam: null,
    queryFn: async ({ pageParam }: { pageParam: Cursor | null }) => {
      const result = await getSdk().transactions.list({
        cursor: pageParam ?? undefined,
        pageSize: PAGE_SIZE,
        accountId,
      });

      for (const transaction of result.transactions) {
        transactionsCache.upsert(transaction);
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
  const result = useQuery({
    queryKey: [TransactionsCache.UnacknowledgedCountKey],
    queryFn: () => getSdk().transactions.countPendingAck(),
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
  const queryClient = useQueryClient();
  const transactionsCache = useTransactionsCache();

  return useMutation({
    mutationFn: async ({ transaction }: { transaction: Transaction }) => {
      await getSdk().transactions.acknowledge(transaction.id);
    },
    onSuccess: (_, { transaction }) => {
      acknowledgeTransactionInHistoryCache(queryClient, transaction);
      transactionsCache.invalidateUnacknowledgedCount();
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

export function useWireTransactionEvents() {
  const transactionsCache = useTransactionsCache();

  useEffect(() => {
    const sdk = getSdk();
    const unsubscribers = [
      sdk.on('transaction:created', ({ entity }) => {
        transactionsCache.upsert(entity);

        if (entity.acknowledgmentStatus === 'pending') {
          transactionsCache.invalidateUnacknowledgedCount();
        }
      }),
      // The decrypted entity carries no `previous_acknowledgment_status`, so we
      // can't gate on a change in ack status as the broadcast handler did;
      // invalidate unconditionally and let the count query refetch.
      sdk.on('transaction:updated', ({ entity }) => {
        transactionsCache.upsert(entity);
        transactionsCache.invalidateUnacknowledgedCount();
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [transactionsCache]);
}
