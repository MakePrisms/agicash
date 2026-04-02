import type { AgicashDbSparkSendQuote } from '@agicash/sdk/db/database';
import type { SparkAccount } from '@agicash/sdk/features/accounts/account';
import type { SparkSendQuote } from '@agicash/sdk/features/send/spark-send-quote';
import { UnresolvedSparkSendQuotesCache } from '@agicash/sdk/features/send/spark-send-quote-queries';
import { DomainError } from '@agicash/sdk/features/shared/error';
import type { Money } from '@agicash/sdk/lib/money/index';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useUser } from '../user/user-hooks';
import { useWalletClient } from '../wallet/wallet-client';
import {
  type SparkLightningQuote,
  useSparkSendQuoteService,
} from './spark-send-quote-service';

export { UnresolvedSparkSendQuotesCache } from '@agicash/sdk/features/send/spark-send-quote-queries';

export function useUnresolvedSparkSendQuotesCache() {
  const { queryClient } = useWalletClient();
  return useMemo(
    () => new UnresolvedSparkSendQuotesCache(queryClient),
    [queryClient],
  );
}

/**
 * Hook that returns spark send quote change handlers.
 */
export function useSparkSendQuoteChangeHandlers() {
  const unresolvedQuotesCache = useUnresolvedSparkSendQuotesCache();
  const wallet = useWalletClient();

  return [
    {
      event: 'SPARK_SEND_QUOTE_CREATED',
      handleEvent: async (payload: AgicashDbSparkSendQuote) => {
        const addedQuote =
          await wallet.repos.sparkSendQuoteRepo.toQuote(payload);
        unresolvedQuotesCache.add(addedQuote);
      },
    },
    {
      event: 'SPARK_SEND_QUOTE_UPDATED',
      handleEvent: async (payload: AgicashDbSparkSendQuote) => {
        const quote = await wallet.repos.sparkSendQuoteRepo.toQuote(payload);

        const isQuoteStillUnresolved =
          quote.state === 'UNPAID' || quote.state === 'PENDING';
        if (isQuoteStillUnresolved) {
          unresolvedQuotesCache.update(quote);
        } else {
          unresolvedQuotesCache.remove(quote);
        }
      },
    },
  ];
}

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
  const sparkSendQuoteService = useSparkSendQuoteService();

  return useMutation({
    mutationFn: async ({
      account,
      paymentRequest,
      amount,
    }: CreateSparkLightningSendQuoteParams) => {
      return sparkSendQuoteService.getLightningSendQuote({
        account,
        paymentRequest,
        amount: amount as Money<'BTC'>,
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
 * The quote is stored in the database in UNPAID state.
 * The background task processor will then trigger the actual lightning payment.
 */
export function useInitiateSparkSendQuote({
  onSuccess,
  onError,
}: {
  onSuccess: (data: SparkSendQuote) => void;
  onError: (error: Error) => void;
}) {
  const userId = useUser((user) => user.id);
  const sparkSendQuoteService = useSparkSendQuoteService();

  return useMutation({
    scope: {
      id: 'create-spark-send-quote',
    },
    mutationFn: ({ account, quote }: CreateSparkSendQuoteParams) => {
      return sparkSendQuoteService.createSendQuote({
        userId,
        account,
        quote,
      });
    },
    onSuccess: (data) => {
      onSuccess(data);
    },
    onError,
    retry: (failureCount, error) => {
      if (error instanceof DomainError) {
        return false;
      }
      return failureCount < 1;
    },
  });
}

/**
 * Hook that processes unresolved spark send quotes.
 * Delegates to the SDK task processor which handles:
 * - For UNPAID quotes: Initiates the lightning payment
 * - For PENDING quotes: Polls the Spark API to check for payment status and updates quotes accordingly.
 */
export function useProcessSparkSendQuoteTasks() {
  const wallet = useWalletClient();

  useEffect(() => {
    void wallet.taskProcessors.sparkSendQuote.start();
    return () => {
      void wallet.taskProcessors.sparkSendQuote.stop();
    };
  }, [wallet]);
}
