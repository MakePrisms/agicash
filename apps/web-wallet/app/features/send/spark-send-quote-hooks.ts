import type { Money } from '@agicash/money';
import type { SparkAccount, SparkLightningQuote } from '@agicash/wallet-sdk';
import { SessionEndedError } from '@agicash/wallet-sdk';
import { DomainError } from '@agicash/wallet-sdk/temporary';
import { useMutation } from '@tanstack/react-query';
import { sdk } from '~/features/shared/sdk.client';

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
  return useMutation({
    mutationFn: ({
      account,
      paymentRequest,
      amount,
    }: CreateSparkLightningSendQuoteParams) => {
      return sdk.send.spark.getLightningQuote({
        account,
        paymentRequest,
        amount,
      });
    },
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
 * The quote is stored in the database in UNPAID state.
 * The background task processor will then trigger the actual lightning payment.
 */
export function useInitiateSparkSendQuote({
  onSuccess,
  onError,
}: {
  onSuccess: (data: { transactionId: string }) => void;
  onError: (error: Error) => void;
}) {
  return useMutation({
    scope: {
      id: 'create-spark-send-quote',
    },
    mutationFn: ({ account, quote }: CreateSparkSendQuoteParams) => {
      return sdk.send.spark.createQuote({
        account,
        lightningQuote: quote,
      });
    },
    onSuccess: (data) => {
      onSuccess(data);
    },
    onError,
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
