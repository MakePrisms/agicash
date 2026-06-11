import type { AgicashDb } from '@agicash/db-types';
import type { QueryClient } from '@tanstack/query-core';
import type { Encryption } from '../encryption';
import { NotFoundError } from '../error';
import type { Transaction } from './transaction';
import { type Cursor, TransactionRepository } from './transaction-repository';
import {
  TransactionsCache,
  createTransactionChangeHandlers,
} from './transactions-cache';

const PAGE_SIZE = 25;

export type TransactionsApi = {
  /**
   * Query config for a single transaction (consume with useSuspenseQuery).
   * The queryFn rejects with NotFoundError when the transaction does not
   * exist; the retry config already skips retries for that case.
   */
  queryOptions: (id: string) => {
    queryKey: (string | undefined)[];
    queryFn: () => Promise<Transaction>;
    retry: (failureCount: number, error: Error) => boolean;
    staleTime: number;
  };
  /**
   * Infinite-query config for the current user's transaction history
   * (consume with useInfiniteQuery), optionally scoped to one account.
   * Each fetched page records its transactions in the per-id state.
   */
  listOptions: (accountId?: string) => {
    queryKey: (string | undefined)[];
    initialPageParam: Cursor | null;
    queryFn: (context: { pageParam: Cursor | null }) => Promise<{
      transactions: Transaction[];
      nextCursor: Cursor | null;
    }>;
    getNextPageParam: (lastPage: {
      nextCursor: Cursor | null;
    }) => Cursor | null;
  };
  /**
   * Query config for the number of the current user's transactions pending
   * acknowledgment.
   */
  pendingAckCountOptions: () => {
    queryKey: string[];
    queryFn: () => Promise<number>;
    staleTime: number;
  };
  /**
   * Marks the transaction as acknowledged and updates the transaction state
   * (history pages + pending-ack count).
   */
  acknowledge: (transaction: Transaction) => Promise<void>;
  /**
   * Transitional escape hatch — NOT part of the public surface. Only for (a)
   * not-yet-migrated SDK collaborators still composed in web feature code
   * (the receive/send services) and (b) the web-owned realtime infrastructure
   * until the SDK owns the realtime hub. App/UI code must use the curated
   * methods above.
   */
  internal: {
    repository: TransactionRepository;
    cache: TransactionsCache;
    changeHandlers: ReturnType<typeof createTransactionChangeHandlers>;
  };
};

export type TransactionsApiDeps = {
  queryClient: QueryClient;
  db: AgicashDb;
  encryption: Encryption;
  /**
   * Resolves the current user's id from the SDK's user state.
   * @throws if no user is loaded yet.
   */
  getCurrentUserId: () => string;
};

export function createTransactionsApi(
  deps: TransactionsApiDeps,
): TransactionsApi {
  const { queryClient, db, encryption, getCurrentUserId } = deps;

  const repository = new TransactionRepository(db, encryption);
  const cache = new TransactionsCache(queryClient);

  return {
    queryOptions: (id: string) => ({
      queryKey: [TransactionsCache.Key, id],
      queryFn: async () => {
        const transaction = await repository.get(id);

        if (!transaction) {
          throw new NotFoundError(`Transaction not found for id: ${id}`);
        }

        return transaction;
      },
      retry: (failureCount: number, error: Error) => {
        if (error instanceof NotFoundError) {
          return false;
        }
        return failureCount <= 3;
      },
      staleTime: Number.POSITIVE_INFINITY,
    }),
    listOptions: (accountId?: string) => ({
      queryKey: [TransactionsCache.AllTransactionsKey, accountId],
      initialPageParam: null,
      queryFn: async ({ pageParam }: { pageParam: Cursor | null }) => {
        const result = await repository.list({
          userId: getCurrentUserId(),
          cursor: pageParam,
          pageSize: PAGE_SIZE,
          accountId,
        });

        for (const transaction of result.transactions) {
          cache.upsert(transaction);
        }

        return {
          transactions: result.transactions,
          nextCursor:
            result.transactions.length === PAGE_SIZE ? result.nextCursor : null,
        };
      },
      getNextPageParam: (lastPage: { nextCursor: Cursor | null }) =>
        lastPage.nextCursor,
    }),
    pendingAckCountOptions: () => ({
      queryKey: [TransactionsCache.UnacknowledgedCountKey],
      queryFn: () =>
        repository.countTransactionsPendingAck({
          userId: getCurrentUserId(),
        }),
      staleTime: Number.POSITIVE_INFINITY,
    }),
    acknowledge: async (transaction: Transaction) => {
      await repository.acknowledgeTransaction({
        userId: getCurrentUserId(),
        transactionId: transaction.id,
      });
      cache.acknowledgeInHistory(transaction);
      cache.invalidateUnacknowledgedCount();
    },
    internal: {
      repository,
      cache,
      changeHandlers: createTransactionChangeHandlers(repository, cache),
    },
  };
}
