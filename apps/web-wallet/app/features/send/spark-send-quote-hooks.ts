import type { Money } from '@agicash/money';
import { DomainError, SdkError } from '@agicash/wallet-sdk';
import { useMutation } from '@tanstack/react-query';
import type { SparkAccount } from '../accounts/account';
import { useSdk } from '../shared/use-sdk';
import type { SparkSendQuote } from './spark-send-quote';
import type { SparkLightningQuote } from './spark-send-quote-service';

type CreateSparkLightningSendQuoteParams = {
  /**
   * The Spark account to send from.
   */
  account: SparkAccount;
  /**
   * The Lightning invoice to pay.
   */
  paymentRequest: string;
  /**
   * Amount to send. Required for zero-amount invoices. If the invoice has an amount, this will be ignored.
   */
  amount?: Money;
};

/**
 * Returns a mutation for creating a Spark Lightning send quote.
 */
export function useCreateSparkLightningSendQuote() {
  const sdkPromise = useSdk();

  return useMutation({
    mutationFn: async ({
      account,
      paymentRequest,
      amount,
    }: CreateSparkLightningSendQuoteParams) => {
      const sdk = await sdkPromise;
      return sdk.spark.send.previewLightningQuote({
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

type CreateSparkSendQuoteParams = {
  /**
   * The Spark account to send from.
   */
  account: SparkAccount;
  /**
   * The quote for the send.
   */
  quote: SparkLightningQuote;
};

/**
 * Returns a mutation for creating a Spark Lightning send quote.
 * The quote is stored in the database in UNPAID state, then `executeQuote`
 * kicks off the lightning payment; the background processor drives it to terminal.
 */
export function useInitiateSparkSendQuote({
  onSuccess,
  onError,
}: {
  onSuccess: (data: SparkSendQuote) => void;
  onError: (error: Error) => void;
}) {
  const sdkPromise = useSdk();

  return useMutation({
    scope: {
      id: 'create-spark-send-quote',
    },
    mutationFn: async ({ account, quote }: CreateSparkSendQuoteParams) => {
      const sdk = await sdkPromise;
      const sendQuote = await sdk.spark.send.createLightningQuote({
        account,
        destination: quote.paymentRequest,
        amount: quote.amountRequested,
      });
      return sdk.spark.send.executeQuote(sendQuote);
    },
    onSuccess: (data) => {
      onSuccess(data);
    },
    onError,
    retry: (failureCount, error) => {
      if (error instanceof DomainError || error instanceof SdkError) {
        return false;
      }
      return failureCount < 1;
    },
  });
}
