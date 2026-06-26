import type { Money } from '@agicash/money';
import { ConcurrencyError, DomainError } from '@agicash/wallet-sdk/temporary';
import { useMutation } from '@tanstack/react-query';
import type { Account } from '../accounts/account';
import { useUser } from '../user/user-hooks';
import type { TransferQuote } from './transfer-service';
import { useTransferService } from './transfer-service';

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
