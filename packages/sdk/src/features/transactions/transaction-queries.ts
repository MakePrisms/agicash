import type { InfiniteData, QueryClient } from '@tanstack/query-core';
import type { FetchQueryOptions } from '@tanstack/query-core';
import {
  allTransactionsQueryKey,
  transactionQueryKey,
  unacknowledgedTransactionsCountQueryKey,
} from '../../core/query-keys';
import { NotFoundError } from '../shared/error';
import type { Transaction } from './transaction';
import type { Cursor, TransactionRepository } from './transaction-repository';

type TransactionsListPage = {
  nextCursor: Cursor | null;
  transactions: Transaction[];
};

export class TransactionsCache {
  public static Key = 'transactions';
  public static AllTransactionsKey = 'all-transactions';
  public static UnacknowledgedCountKey = 'unacknowledged-transactions-count';

  constructor(private readonly queryClient: QueryClient) {}

  upsert(transaction: Transaction) {
    this.queryClient.setQueryData<Transaction>(
      [TransactionsCache.Key, transaction.id],
      (curr) =>
        !curr || transaction.version > curr.version ? transaction : undefined,
    );
  }

  invalidate() {
    return Promise.all([
      this.queryClient.invalidateQueries({
        queryKey: [TransactionsCache.Key],
      }),
      this.queryClient.invalidateQueries({
        queryKey: [TransactionsCache.AllTransactionsKey],
      }),
      this.queryClient.invalidateQueries({
        queryKey: unacknowledgedTransactionsCountQueryKey(),
      }),
    ]);
  }

  invalidateTransaction(transactionId: string) {
    return this.queryClient.invalidateQueries({
      queryKey: transactionQueryKey(transactionId),
    });
  }

  invalidateUnacknowledgedCount() {
    return this.queryClient.invalidateQueries({
      queryKey: unacknowledgedTransactionsCountQueryKey(),
    });
  }
}

const PAGE_SIZE = 25;

export const transactionQuery = ({
  transactionId,
  transactionRepository,
}: {
  transactionId: string;
  transactionRepository: TransactionRepository;
}) =>
  ({
    queryKey: transactionQueryKey(transactionId),
    queryFn: async () => {
      const transaction = await transactionRepository.get(transactionId);

      if (!transaction) {
        throw new NotFoundError(
          `Transaction not found for id: ${transactionId}`,
        );
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
  }) satisfies FetchQueryOptions<Transaction, Error>;

export const transactionsListQuery = ({
  accountId,
  pageSize = PAGE_SIZE,
  transactionsCache,
  transactionRepository,
  userId,
}: {
  accountId?: string;
  pageSize?: number;
  transactionsCache: TransactionsCache;
  transactionRepository: TransactionRepository;
  userId: string;
}) => ({
  getNextPageParam: (lastPage: TransactionsListPage) => lastPage.nextCursor,
  initialPageParam: null as Cursor | null,
  queryFn: async ({ pageParam }: { pageParam: Cursor | null }) => {
    const result = await transactionRepository.list({
      accountId,
      cursor: pageParam,
      pageSize,
      userId,
    });

    for (const transaction of result.transactions) {
      transactionsCache.upsert(transaction);
    }

    return {
      nextCursor:
        result.transactions.length === pageSize ? result.nextCursor : null,
      transactions: result.transactions,
    };
  },
  queryKey: allTransactionsQueryKey(accountId),
  retry: 1,
});

export const unacknowledgedTransactionsCountQuery = ({
  transactionRepository,
  userId,
}: {
  transactionRepository: TransactionRepository;
  userId: string;
}) =>
  ({
    queryKey: unacknowledgedTransactionsCountQueryKey(),
    queryFn: () =>
      transactionRepository.countTransactionsPendingAck({
        userId,
      }),
    retry: 1,
    staleTime: Number.POSITIVE_INFINITY,
  }) satisfies FetchQueryOptions<number, Error>;

export const acknowledgeTransactionInHistoryCache = (
  queryClient: QueryClient,
  transaction: Transaction,
) => {
  const queries = queryClient.getQueriesData<
    InfiniteData<TransactionsListPage>
  >({
    queryKey: [TransactionsCache.AllTransactionsKey],
  });

  queries.forEach(([queryKey, data]) => {
    if (!data) {
      return;
    }

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
