import type { Money } from '@agicash/money';
import { ConcurrencyError, DomainError, SdkError } from '@agicash/wallet-sdk';
import { useMutation } from '@tanstack/react-query';
import type { CashuAccount } from '../accounts/account';
import { useSdk } from '../shared/use-sdk';
import type { CashuSendQuote } from './cashu-send-quote';
import type { CashuLightningQuote } from './cashu-send-quote-service';

export function useCreateCashuLightningSendQuote() {
  const sdkPromise = useSdk();

  return useMutation({
    scope: {
      id: 'create-cashu-lightning-send-quote',
    },
    mutationFn: async ({
      account,
      amount,
      paymentRequest,
    }: {
      account: CashuAccount;
      paymentRequest: string;
      amount?: Money;
    }) => {
      const sdk = await sdkPromise;
      return sdk.cashu.send.previewLightningQuote({
        account,
        destination: paymentRequest,
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

export function useInitiateCashuSendQuote({
  onSuccess,
  onError,
}: {
  onSuccess: (data: CashuSendQuote) => void;
  onError: (error: Error) => void;
}) {
  const sdkPromise = useSdk();

  return useMutation({
    mutationKey: ['initiate-cashu-send-quote'],
    scope: {
      id: 'initiate-cashu-send-quote',
    },
    mutationFn: async ({
      account,
      sendQuote,
    }: {
      account: CashuAccount;
      sendQuote: CashuLightningQuote;
    }) => {
      const sdk = await sdkPromise;
      const quote = await sdk.cashu.send.createLightningQuote({
        account,
        destination: sendQuote.paymentRequest,
        amount: sendQuote.amountRequested,
      });
      return sdk.cashu.send.executeQuote(quote);
    },
    onSuccess: (data) => {
      onSuccess(data);
    },
    onError: onError,
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
