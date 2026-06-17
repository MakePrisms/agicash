import type { Money } from '@agicash/utils/money';
import type { CashuAccount } from '@agicash/wallet-sdk/accounts/account';
import { ConcurrencyError, DomainError } from '@agicash/wallet-sdk/error';
import type {
  CashuSendQuote,
  DestinationDetails,
  SendQuoteRequest,
} from '@agicash/wallet-sdk/send/cashu-send-quote';
import { useMutation } from '@tanstack/react-query';
import type Big from 'big.js';
import { useGetCashuAccount } from '../accounts/account-hooks';
import { useSdk } from '../shared/sdk';

export function useCreateCashuLightningSendQuote() {
  const sdk = useSdk();
  return useMutation({
    scope: {
      id: 'create-cashu-lightning-send-quote',
    },
    mutationFn: (props: {
      account: CashuAccount;
      paymentRequest: string;
      amount?: Money;
      exchangeRate?: Big;
    }) => sdk.send.getCashuLightningQuote(props),
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
  const sdk = useSdk();

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
      sendQuote: SendQuoteRequest;
      destinationDetails?: DestinationDetails;
    }) => {
      const account = getCashuAccount(accountId);
      return sdk.send.createCashuSendQuote({
        account,
        sendQuote,
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
