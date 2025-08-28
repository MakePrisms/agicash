import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  type AgicashDbTransaction,
  agicashDb,
} from '~/features/agicash-db/database';
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
const hasUnseenTransactionsQueryKey = 'has-unseen-transactions';

export function useTransaction({
  transactionId,
}: {
  transactionId?: string;
}) {
  const enabled = !!transactionId;
  const transactionRepository = useTransactionRepository();

  useTrackTransaction(transactionId);

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

  useTrackTransaction(id);

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
  });

  return result;
}

export function useHasUnseenTransactions({
  transactionTypes,
  transactionStates,
  transactionDirections,
}: {
  transactionTypes: Transaction['type'][];
  transactionStates: Transaction['state'][];
  transactionDirections: Transaction['direction'][];
}) {
  const transactionRepository = useTransactionRepository();
  const userId = useUser((user) => user.id);

  return useQuery({
    queryKey: [
      hasUnseenTransactionsQueryKey,
      transactionTypes,
      transactionStates,
    ],
    queryFn: () =>
      transactionRepository.hasUnseenTransactions({
        userId,
        transactionTypes,
        transactionStates,
        transactionDirections,
      }),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: 1,
  });
}

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

      // Find the transaction in the cache and update it
      queryClient.setQueryData<
        InfiniteData<{
          transactions: Transaction[];
          nextCursor: string | null;
        }>
      >([allTransactionsQueryKey], (old) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            transactions: page.transactions.map((tx) =>
              tx.id === transaction.id ? { ...tx, seen: true } : tx,
            ),
          })),
        };
      });
    },
    retry: 1,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [hasUnseenTransactionsQueryKey],
      });
    },
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
  transactionId,
  onUpdated,
}: {
  transactionId?: string;
  onUpdated: (transaction: Transaction) => void;
}) {
  const onUpdatedRef = useLatest(onUpdated);
  const transactionRepository = useTransactionRepository();

  useEffect(() => {
    if (!transactionId) return;

    const channel = agicashDb
      .channel(`transaction-${transactionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'wallet',
          table: 'transactions',
          filter: `id=eq.${transactionId}`,
        },
        async (
          payload: RealtimePostgresChangesPayload<AgicashDbTransaction>,
        ) => {
          if (payload.eventType === 'UPDATE') {
            const updatedTransaction =
              await transactionRepository.toTransaction(payload.new);
            onUpdatedRef.current(updatedTransaction);
          }
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [transactionId, transactionRepository]);
}

/** Listens for changes to a transaction in the Agicash DB and updates the query client with the latest transaction. */
function useTrackTransaction(id?: string) {
  const queryClient = useQueryClient();

  useOnTransactionChange({
    transactionId: id,
    onUpdated: (updatedTransaction) => {
      queryClient.setQueryData<Transaction>(
        [transactionQueryKey, updatedTransaction.id],
        updatedTransaction,
      );
    },
  });
}
