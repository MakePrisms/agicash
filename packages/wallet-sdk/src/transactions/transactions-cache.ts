import type { AgicashDbTransaction } from '@agicash/db-types';
import type { InfiniteData, QueryClient } from '@tanstack/query-core';
import type { Transaction } from './transaction';
import type { Cursor, TransactionRepository } from './transaction-repository';

/**
 * Cache that manages transaction data and acknowledgment counts.
 */
export class TransactionsCache {
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
   * Marks the transaction as acknowledged in every transaction-history page
   * (both the unified and the account-specific infinite queries).
   */
  acknowledgeInHistory(transaction: Transaction) {
    const queries = this.queryClient.getQueriesData<
      InfiniteData<{
        transactions: Transaction[];
        nextCursor: Cursor | null;
      }>
    >({ queryKey: [TransactionsCache.AllTransactionsKey] });

    queries.forEach(([queryKey, data]) => {
      if (!data) return;

      this.queryClient.setQueryData(queryKey, {
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

/**
 * Realtime transaction change handlers: each handler maps the broadcast DB
 * row to a Transaction (repository decrypts the details) and upserts it into
 * the cache (version-guarded).
 */
export function createTransactionChangeHandlers(
  transactionRepository: TransactionRepository,
  transactionsCache: TransactionsCache,
) {
  return [
    {
      event: 'TRANSACTION_CREATED',
      handleEvent: async (payload: AgicashDbTransaction) => {
        const transaction = await transactionRepository.toTransaction(payload);
        transactionsCache.upsert(transaction);

        if (transaction.acknowledgmentStatus === 'pending') {
          transactionsCache.invalidateUnacknowledgedCount();
        }
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
        transactionsCache.upsert(transaction);

        if (
          payload.previous_acknowledgment_status !==
          transaction.acknowledgmentStatus
        ) {
          transactionsCache.invalidateUnacknowledgedCount();
        }
      },
    },
  ];
}
