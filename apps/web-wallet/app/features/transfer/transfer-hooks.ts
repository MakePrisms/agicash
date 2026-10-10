import type { Money } from '@agicash/money';
import type { Account, TransferQuote } from '@agicash/wallet-sdk';
import { SessionEndedError } from '@agicash/wallet-sdk';
import { ConcurrencyError, DomainError } from '@agicash/wallet-sdk/temporary';
import { useMutation } from '@tanstack/react-query';
import { sdk } from '~/features/shared/sdk.client';

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
    }) => sdk.transfer.getQuote({ sourceAccount, destinationAccount, amount }),
    retry: (failureCount, error) => {
      if (error instanceof SessionEndedError) {
        return false;
      }

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
      return sdk.transfer.initiate({ quote });
    },
    retry: (failureCount, error) => {
      if (error instanceof SessionEndedError) {
        return false;
      }

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
