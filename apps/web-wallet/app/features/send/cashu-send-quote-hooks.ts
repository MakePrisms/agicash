import type { Money } from '@agicash/money';
import type {
  CashuAccount,
  CashuLightningQuote,
  DestinationDetails,
} from '@agicash/wallet-sdk';
import { SessionEndedError } from '@agicash/wallet-sdk';
import {
  CashuSendQuoteRepository,
  ConcurrencyError,
  DomainError,
} from '@agicash/wallet-sdk/temporary';
import { useMutation } from '@tanstack/react-query';
import { sdk } from '~/features/shared/sdk.client';
import { useGetCashuAccount } from '../accounts/account-hooks';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption-hooks';

export function useCashuSendQuoteRepository() {
  const encryption = useEncryption();
  return new CashuSendQuoteRepository(agicashDbClient, encryption);
}

export function useCreateCashuLightningSendQuote() {
  return useMutation({
    scope: {
      id: 'create-cashu-lightning-send-quote',
    },
    mutationFn: ({
      account,
      amount,
      paymentRequest,
    }: {
      account: CashuAccount;
      paymentRequest: string;
      amount?: Money;
    }) =>
      sdk.send.cashu.getLightningQuote({
        account,
        amount,
        paymentRequest,
      }),
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

export function useInitiateCashuSendQuote({
  onSuccess,
  onError,
}: {
  onSuccess: (data: { transactionId: string }) => void;
  onError: (error: Error) => void;
}) {
  const getCashuAccount = useGetCashuAccount();

  return useMutation({
    mutationKey: ['initiate-cashu-send-quote'],
    scope: {
      id: 'initiate-cashu-send-quote',
    },
    mutationFn: ({
      accountId,
      sendQuote,
      destinationDetails,
    }: {
      accountId: string;
      sendQuote: CashuLightningQuote;
      destinationDetails?: DestinationDetails;
    }) => {
      // Read per attempt: a ConcurrencyError retry must reselect proofs from
      // the latest cached account, not the one the first attempt saw.
      const account = getCashuAccount(accountId);
      return sdk.send.cashu.createQuote({
        account,
        lightningQuote: sendQuote,
        destinationDetails,
      });
    },
    onSuccess: (data) => {
      onSuccess(data);
    },
    onError: onError,
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
