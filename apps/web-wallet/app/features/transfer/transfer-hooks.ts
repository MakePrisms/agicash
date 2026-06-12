import type { Money } from '@agicash/utils/money';
import type { Account } from '@agicash/wallet-sdk/accounts/account';
import { ConcurrencyError, DomainError } from '@agicash/wallet-sdk/error';
import type { TransferQuote } from '@agicash/wallet-sdk/transfer/transfer-service';
import { useMutation } from '@tanstack/react-query';
import { getSdk } from '../shared/sdk';

export function useGetTransferQuote() {
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
      return getSdk().transfer.getTransferQuote({
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
  return useMutation({
    mutationFn: ({ quote }: { quote: TransferQuote }) => {
      return getSdk().transfer.initiateTransfer({ quote });
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
