import type { Transaction } from '@agicash/sdk/features/transactions/transaction';
import { acknowledgeTransactionInHistoryCache } from '@agicash/sdk/features/transactions/transaction-queries';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useLatest } from '~/lib/use-latest';
import { useGetCashuAccount } from '../accounts/account-hooks';
import { useCashuSendSwapRepository } from '../send/cashu-send-swap-repository';
import { useCashuSendSwapService } from '../send/cashu-send-swap-service';
import { useUser } from '../user/user-hooks';
import { useWalletClient } from '../wallet/wallet-client';
import { useTransactionRepository } from './transaction-repository';

export function useTransactionsCache() {
  const wallet = useWalletClient();
  return wallet.caches.transactions;
}

export function useTransaction(id: string) {
  const wallet = useWalletClient();

  return useSuspenseQuery({
    ...wallet.queries.transactionQuery(id),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
}

export function useTransactions(accountId?: string) {
  const wallet = useWalletClient();

  return useInfiniteQuery({
    ...wallet.queries.transactionsListQuery(accountId),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
}

export function useHasTransactionsPendingAck() {
  const wallet = useWalletClient();

  const result = useQuery({
    ...wallet.queries.unacknowledgedTransactionsCountQuery(),
    select: (data) => data > 0,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });

  return result.data ?? false;
}

export function useAcknowledgeTransaction() {
  const transactionRepository = useTransactionRepository();
  const userId = useUser((user) => user.id);
  const queryClient = useQueryClient();
  const transactionsCache = useTransactionsCache();

  return useMutation({
    mutationFn: async ({ transaction }: { transaction: Transaction }) => {
      await transactionRepository.acknowledgeTransaction({
        userId,
        transactionId: transaction.id,
      });
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
