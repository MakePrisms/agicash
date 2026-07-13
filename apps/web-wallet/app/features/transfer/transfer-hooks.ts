import type { Money } from '@agicash/money';
import type { TransferQuote } from '@agicash/wallet-sdk';
import type { Account } from '@agicash/wallet-sdk/temporary';
import { ConcurrencyError, DomainError } from '@agicash/wallet-sdk/temporary';
import { useMutation } from '@tanstack/react-query';
import { useUser } from '../user/user-hooks';
import { useTransferService } from './transfer-service-hooks';

export function useGetTransferQuote() {
  const transferService = useTransferService();

  return useMutation({
    mutationFn: ({
      sourceAccount,
      destinationAccount,
      amount,
    }: {
      sourceAccount: Account;
      destinationAccount: Account;
      amount: Money;
    }) => {
      return transferService.getTransferQuote({
        sourceAccount,
        destinationAccount,
        amount,
      });
    },
    retry: (failureCount, error) => {
      if (error instanceof DomainError) {
        return false;
      }

      return failureCount < 1;
    },
  });
}

export function useInitiateTransfer() {
  const userId = useUser((user) => user.id);
  const transferService = useTransferService();

  return useMutation({
    mutationFn: ({ quote }: { quote: TransferQuote }) => {
      return transferService.initiateTransfer({ userId, quote });
    },
    retry: (failureCount, error) => {
      if (error instanceof ConcurrencyError) {
        return true;
      }

      if (error instanceof DomainError) {
        return false;
      }

      return failureCount < 1;
    },
  });
}
