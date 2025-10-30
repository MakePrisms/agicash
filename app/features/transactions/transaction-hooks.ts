import type { WalletTransfer } from '@buildonspark/spark-sdk/types';
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
import { type Currency, Money } from '~/lib/money';
import { useLatest } from '~/lib/use-latest';
import { useGetLatestCashuAccount } from '../accounts/account-hooks';
import { useAccounts } from '../accounts/account-hooks';
import { useCashuSendSwapRepository } from '../send/cashu-send-swap-repository';
import { useCashuSendSwapService } from '../send/cashu-send-swap-service';
import { getDefaultUnit } from '../shared/currencies';
import { useSparkWallet } from '../shared/spark';
import { useUser } from '../user/user-hooks';
import type {
  SparkTransferTransactionDetails,
  Transaction,
} from './transaction';
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
  const userId = useUser((user) => user.id);
  const { data: accounts } = useAccounts({ type: 'spark' });
  const sparkWallet = useSparkWallet();

  return useQuery({
    queryKey: [TransactionsCache.Key, transactionId],
    queryFn: async () => {
      const id = transactionId ?? '';

      // Check if this is a Spark transaction
      if (id.startsWith('spark-')) {
        const transferId = id.replace('spark-', '');
        const transfer = await sparkWallet.getTransfer(transferId);

        if (!transfer) {
          throw new Error(`Spark transfer not found: ${transferId}`);
        }

        if (!accounts || accounts.length === 0) {
          throw new Error('No Spark account found for transaction');
        }

        const sparkAccount = accounts[0]; // TODO: we're assuming one spark account total
        return mapWalletTransferToTransaction(
          transfer,
          sparkAccount.id,
          userId,
          sparkAccount.currency,
        );
      }

      // Otherwise, fetch from database
      return transactionRepository.get(id);
    },
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
}

export function useSuspenseTransaction(id: string) {
  const transactionRepository = useTransactionRepository();
  const userId = useUser((user) => user.id);
  const { data: accounts } = useAccounts({ type: 'spark' });
  const sparkWallet = useSparkWallet();

  return useSuspenseQuery({
    queryKey: [TransactionsCache.Key, id],
    queryFn: async () => {
      // Check if this is a Spark transaction
      if (id.startsWith('spark-')) {
        const transferId = id.replace('spark-', '');
        const transfer = await sparkWallet.getTransfer(transferId);

        if (!transfer) {
          throw new Error(`Spark transfer not found: ${transferId}`);
        }

        if (!accounts || accounts.length === 0) {
          throw new Error('No Spark account found for transaction');
        }

        const sparkAccount = accounts[0]; // TODO: we're assuming one spark account total
        return mapWalletTransferToTransaction(
          transfer,
          sparkAccount.id,
          userId,
          sparkAccount.currency,
        );
      }

      // Otherwise, fetch from database
      return transactionRepository.get(id);
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
}

const PAGE_SIZE = 25;
const SPARK_FETCH_SIZE = 30; // Spark's default limit

type PageParam = {
  dbCursor: Cursor | null;
  sparkOffset: number;
  sparkBuffer: Transaction[]; // Spark transactions we've fetched but not yet returned to user
};

export function useTransactions() {
  const userId = useUser((user) => user.id);
  const transactionRepository = useTransactionRepository();
  const { data: accounts } = useAccounts({ type: 'spark' });
  const sparkWallet = useSparkWallet();

  const result = useInfiniteQuery({
    queryKey: [allTransactionsQueryKey],
    initialPageParam: {
      dbCursor: null,
      sparkOffset: 0,
      sparkBuffer: [],
    } satisfies PageParam,
    queryFn: async ({ pageParam }: { pageParam: PageParam }) => {
      const { dbCursor, sparkOffset, sparkBuffer } = pageParam;

      // Fetch Spark transfers if user has Spark accounts
      const updatedSparkBuffer = [...sparkBuffer];
      let nextSparkOffset = sparkOffset;

      if (accounts && accounts.length > 0) {
        try {
          const sparkResult = await sparkWallet.getTransfers(
            SPARK_FETCH_SIZE,
            sparkOffset,
          );
          const sparkAccount = accounts[0]; // TODO: we're assuming one spark account total

          // Map fetched transfers to transactions and add to buffer
          const newSparkTransactions = sparkResult.transfers.map((transfer) =>
            mapWalletTransferToTransaction(
              transfer,
              sparkAccount.id,
              userId,
              sparkAccount.currency,
            ),
          );

          updatedSparkBuffer.push(...newSparkTransactions);
          nextSparkOffset = sparkResult.offset;
        } catch (error) {
          console.error('Failed to fetch Spark transfers:', error);
        }
      }

      // Fetch DB transactions
      const dbResult = await transactionRepository.list({
        userId,
        cursor: dbCursor,
        pageSize: PAGE_SIZE,
      });

      // Merge Spark buffer and DB transactions, then sort by creation date (newest first)
      const allTransactions = [
        ...dbResult.transactions,
        ...updatedSparkBuffer,
      ].sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateB - dateA;
      });

      // Take up to PAGE_SIZE transactions to return
      const transactionsToReturn = allTransactions.slice(0, PAGE_SIZE);

      // Find which transactions were returned so we can update the buffer
      // Remove returned Spark transactions from buffer
      const returnedIds = new Set(transactionsToReturn.map((tx) => tx.id));
      const remainingSparkBuffer = updatedSparkBuffer.filter(
        (tx) => !returnedIds.has(tx.id),
      );

      // Determine if there are more pages
      const hasMoreDbTransactions = dbResult.transactions.length === PAGE_SIZE;
      const hasMoreSparkTransfers =
        remainingSparkBuffer.length > 0 ||
        (accounts && accounts.length > 0 && nextSparkOffset > sparkOffset);
      const hasNextPage =
        allTransactions.length > PAGE_SIZE ||
        hasMoreDbTransactions ||
        hasMoreSparkTransfers;

      return {
        transactions: transactionsToReturn,
        nextCursor: hasNextPage
          ? {
              dbCursor: dbResult.nextCursor,
              sparkOffset: nextSparkOffset,
              sparkBuffer: remainingSparkBuffer,
            }
          : null,
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

/**
 * Maps a WalletTransfer from Spark SDK to our Transaction type.
 */
function mapWalletTransferToTransaction(
  transfer: WalletTransfer,
  accountId: string,
  userId: string,
  currency: Currency,
): Transaction {
  const direction =
    transfer.transferDirection === 'INCOMING' ? 'RECEIVE' : 'SEND';

  // Map Spark transfer status to our transaction state
  const statusMap: Record<string, Transaction['state']> = {
    TRANSFER_STATUS_COMPLETED: 'COMPLETED',
    TRANSFER_STATUS_EXPIRED: 'FAILED',
    TRANSFER_STATUS_RETURNED: 'REVERSED',
    // All other statuses are considered PENDING
  };

  const state = statusMap[transfer.status] || 'PENDING';

  const amount = new Money({
    amount: transfer.totalValue.toString(),
    currency,
    unit: getDefaultUnit(currency),
  });

  const details: SparkTransferTransactionDetails = {
    transferId: transfer.id,
    senderIdentityPublicKey: transfer.senderIdentityPublicKey,
    receiverIdentityPublicKey: transfer.receiverIdentityPublicKey,
    expiryTime: transfer.expiryTime?.toISOString(),
  };

  return {
    id: `spark-${transfer.id}`,
    userId,
    direction,
    type: 'SPARK_TRANSFER',
    state,
    accountId,
    amount,
    details,
    acknowledgmentStatus: null,
    createdAt: transfer.createdTime?.toISOString() ?? new Date().toISOString(),
    pendingAt: state === 'PENDING' ? transfer.createdTime?.toISOString() : null,
    completedAt:
      state === 'COMPLETED' ? transfer.updatedTime?.toISOString() : null,
    failedAt: state === 'FAILED' ? transfer.updatedTime?.toISOString() : null,
    reversedAt:
      state === 'REVERSED' ? transfer.updatedTime?.toISOString() : null,
    reversedTransactionId: null,
  };
}
