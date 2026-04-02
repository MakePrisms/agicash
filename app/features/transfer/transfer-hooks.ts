import type { Account } from '@agicash/sdk/features/accounts/account';
import {
  ConcurrencyError,
  DomainError,
} from '@agicash/sdk/features/shared/error';
import type { Money } from '@agicash/sdk/lib/money/index';
import { useMutation } from '@tanstack/react-query';
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
