import type { Money } from '@agicash/money';
import {
  ConcurrencyError,
  DomainError,
  SdkError,
  type TransferQuote,
} from '@agicash/wallet-sdk';
import { useMutation } from '@tanstack/react-query';
import type { Account } from '../accounts/account';
import { useSdk } from '../shared/use-sdk';

export function useGetTransferQuote() {
  const sdkPromise = useSdk();

  return useMutation({
    mutationFn: async ({
      sourceAccount,
      destinationAccount,
      amount,
    }: {
      sourceAccount: Account;
      destinationAccount: Account;
      amount: Money;
    }) => {
      const sdk = await sdkPromise;
      return sdk.transfers.createQuote({
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
  const sdkPromise = useSdk();

  return useMutation({
    mutationFn: async ({ quote }: { quote: TransferQuote }) => {
      const sdk = await sdkPromise;
      return sdk.transfers.executeQuote(quote);
    },
    retry: (failureCount, error) => {
      if (error instanceof ConcurrencyError) {
        return true;
      }

      if (error instanceof DomainError || error instanceof SdkError) {
        return false;
      }

      return failureCount < 1;
    },
  });
}
