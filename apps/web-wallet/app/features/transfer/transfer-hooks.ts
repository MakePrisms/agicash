import type { Money } from '@agicash/money';
import type { TransferQuote } from '@agicash/wallet-sdk';
import { useMutation } from '@tanstack/react-query';
import { getSdk } from '~/lib/sdk';
import type { Account } from '../accounts/account';
import { ConcurrencyError, DomainError } from '../shared/error';

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
      return getSdk().transfers.createQuote({
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
      return getSdk().transfers.execute(quote);
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
