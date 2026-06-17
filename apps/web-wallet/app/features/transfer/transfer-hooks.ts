import type { Money } from '@agicash/utils/money';
import type { Account } from '@agicash/wallet-sdk/accounts/account';
import { ConcurrencyError, DomainError } from '@agicash/wallet-sdk/error';
import type { TransferQuote } from '@agicash/wallet-sdk/transfer/transfer';
import { useMutation } from '@tanstack/react-query';
import { useSdk } from '../shared/sdk';

export function useGetTransferQuote() {
  const sdk = useSdk();
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
      return sdk.transfer.getTransferQuote({
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
  const sdk = useSdk();
  return useMutation({
    mutationFn: ({ quote }: { quote: TransferQuote }) => {
      return sdk.transfer.initiateTransfer({ quote });
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
