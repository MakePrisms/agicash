import type {
  CashuLightningQuote,
  DestinationDetails,
} from '@agicash/wallet-sdk';
import type { Money } from '@agicash/money';
import { useMutation } from '@tanstack/react-query';
import type Big from 'big.js';
import { getSdk } from '~/lib/sdk';
import type { CashuAccount } from '../accounts/account';
import { useGetCashuAccount } from '../accounts/account-hooks';
import { ConcurrencyError, DomainError } from '../shared/error';
import type { CashuSendQuote } from './cashu-send-quote';

export function useCreateCashuLightningSendQuote() {
  return useMutation({
    scope: {
      id: 'create-cashu-lightning-send-quote',
    },
    mutationFn: ({
      account,
      amount,
      paymentRequest,
      exchangeRate,
    }: {
      account: CashuAccount;
      paymentRequest: string;
      amount?: Money;
      exchangeRate?: Big;
    }) =>
      getSdk().cashu.send.createLightningQuote({
        account,
        amount,
        paymentRequest,
        exchangeRate,
      }),
    retry: (failureCount, error) => {
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
  onSuccess: (data: CashuSendQuote) => void;
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
      const account = getCashuAccount(accountId);
      // Create-only: the SDK leader performs the melt asynchronously.
      return getSdk().cashu.send.execute({
        account,
        quote: sendQuote,
        destinationDetails,
      });
    },
    onSuccess: (data) => {
      onSuccess(data);
    },
    onError: onError,
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
