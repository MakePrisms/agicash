import { useSdk } from '@agicash/react-wallet-sdk';
import { useQ } from '@agicash/react-wallet-sdk';
import type { TransactionCursor } from '@agicash/wallet-sdk';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useLatest } from '~/lib/use-latest';
import { useGetCashuAccount } from '../accounts/account-hooks';
import { useCashuSendSwapRepository } from '../send/cashu-send-swap-repository';
import { useCashuSendSwapService } from '../send/cashu-send-swap-service';
import { NotFoundError } from '../shared/error';
import type { Transaction } from './transaction';

export function useTransaction(id: string): Transaction {
  const sdk = useSdk();
  const transaction = useQ(sdk.transactions.get(id));

  if (!transaction) {
    throw new NotFoundError(`Transaction not found for id: ${id}`);
  }

  return transaction as unknown as Transaction;
}

const ALL_TRANSACTIONS_KEY = 'all-transactions';

type TransactionsPage = {
  transactions: Transaction[];
  nextCursor: TransactionCursor | null;
};

export function useTransactions(accountId?: string) {
  const sdk = useSdk();

  return useInfiniteQuery({
    queryKey: [ALL_TRANSACTIONS_KEY, accountId],
    initialPageParam: undefined as TransactionCursor | undefined,
    queryFn: ({ pageParam }: { pageParam: TransactionCursor | undefined }) =>
      // The SDK and web `Transaction` types are structurally equivalent at
      // runtime; the web's zod-narrowed union is just stricter on `details`.
      sdk.transactions
        .list({ accountId, cursor: pageParam ?? undefined })
        .toPromise() as Promise<TransactionsPage>,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: 1,
  });
}

export function useHasTransactionsPendingAck() {
  const sdk = useSdk();
  const count = useQ(sdk.transactions.countPendingAck());
  return count > 0;
}

export function useAcknowledgeTransaction() {
  const sdk = useSdk();

  return useMutation({
    mutationFn: async ({ transaction }: { transaction: Transaction }) => {
      await sdk.transactions.acknowledge(
        transaction as unknown as Parameters<
          typeof sdk.transactions.acknowledge
        >[0],
      );
    },
    onSuccess: () => {
      void sdk.transactions.list().refetch();
      void sdk.transactions.countPendingAck().refetch();
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
