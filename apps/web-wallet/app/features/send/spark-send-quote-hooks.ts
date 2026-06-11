import type { Payment } from '@agicash/breez-sdk-spark';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { Money } from '~/lib/money';
import { useLatest } from '~/lib/use-latest';
import type { SparkAccount } from '../accounts/account';
import {
  useGetSparkAccount,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import { DomainError } from '../shared/error';
import { getSdk } from '../shared/sdk';
import { sparkDebugLog } from '../shared/spark';
import type { SparkSendQuote } from './spark-send-quote';
import type { SparkLightningQuote } from './spark-send-quote-service';

/**
 * Transitional (sdk.send.internal): only for the web-owned realtime wiring
 * and task processing until the SDK owns them (Phase 8).
 */
export function useUnresolvedSparkSendQuotesCache() {
  return getSdk().send.internal.unresolvedSparkSendQuotesCache;
}

const useUnresolvedSparkSendQuotes = () => {
  const selectWithOnlineAccount = useSelectItemsWithOnlineAccount();

  const { data } = useQuery({
    ...getSdk().send.unresolvedSparkQuotesOptions(),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    throwOnError: true,
    select: selectWithOnlineAccount,
  });

  return data ?? [];
};

type OnSparkSendStateChangeCallbacks = {
  sendQuotes: SparkSendQuote[];
  onUnpaid: (quote: SparkSendQuote) => void;
  onCompleted: (
    quote: SparkSendQuote,
    paymentData: { paymentPreimage: string },
  ) => void;
  onFailed: (quote: SparkSendQuote, failureReason: string) => void;
};

/**
 * Hook that fires callbacks when the state of a send quote changes.
 *
 * Uses event-driven approach via Breez SDK event listeners.
 * One listener per Spark account is registered. An initial status check
 * is performed for each pending quote to catch events that fired before
 * the listener was registered.
 */
export function useOnSparkSendStateChange({
  sendQuotes,
  onUnpaid,
  onCompleted,
  onFailed,
}: OnSparkSendStateChangeCallbacks) {
  const getSparkAccount = useGetSparkAccount();

  const onUnpaidRef = useLatest(onUnpaid);
  const onCompletedRef = useLatest(onCompleted);
  const onFailedRef = useLatest(onFailed);

  // Track the last triggered state for each quote to avoid duplicate callbacks
  const lastTriggeredStateRef = useRef<Map<string, SparkSendQuote['state']>>(
    new Map(),
  );

  useEffect(() => {
    const listenerCleanups: (() => void)[] = [];

    const quoteIds = sendQuotes.map((q) => q.id);
    const quoteIdSet = new Set(quoteIds);

    // Clean up tracked states for quotes that are no longer in the list
    for (const trackedQuoteId of lastTriggeredStateRef.current.keys()) {
      if (!quoteIdSet.has(trackedQuoteId)) {
        lastTriggeredStateRef.current.delete(trackedQuoteId);
      }
    }

    if (quoteIds.length === 0) return;

    type PendingQuote = Extract<SparkSendQuote, { state: 'PENDING' }>;
    const pendingQuotesByAccount = new Map<string, PendingQuote[]>();

    for (const quote of sendQuotes) {
      if (quote.state === 'UNPAID') {
        if (lastTriggeredStateRef.current.get(quote.id) !== 'UNPAID') {
          lastTriggeredStateRef.current.set(quote.id, 'UNPAID');
          onUnpaidRef.current(quote);
        }
      } else if (quote.state === 'PENDING') {
        const existing = pendingQuotesByAccount.get(quote.accountId);
        if (existing) {
          existing.push(quote);
        } else {
          pendingQuotesByAccount.set(quote.accountId, [quote]);
        }
      }
    }

    for (const [accountId, quotes] of pendingQuotesByAccount) {
      const account = getSparkAccount(accountId);
      const quoteByTransferId = new Map(
        quotes.map((q) => [q.sparkTransferId, q]),
      );

      const handlePaymentEvent = (payment: Payment, eventType: string) => {
        const quote = quoteByTransferId.get(payment.id);
        if (!quote) return;

        if (
          eventType === 'paymentSucceeded' &&
          lastTriggeredStateRef.current.get(quote.id) !== 'COMPLETED'
        ) {
          const preimage =
            payment.details?.type === 'lightning'
              ? payment.details.htlcDetails.preimage
              : undefined;
          if (!preimage) {
            console.error('Payment succeeded but no preimage', {
              paymentId: payment.id,
            });
            return;
          }
          lastTriggeredStateRef.current.set(quote.id, 'COMPLETED');
          sparkDebugLog('Send payment detected as completed', {
            quoteId: quote.id,
            accountId,
          });
          onCompletedRef.current(quote, { paymentPreimage: preimage });
        } else if (
          eventType === 'paymentFailed' &&
          lastTriggeredStateRef.current.get(quote.id) !== 'FAILED'
        ) {
          lastTriggeredStateRef.current.set(quote.id, 'FAILED');
          const message =
            quote.expiresAt && new Date(quote.expiresAt) < new Date()
              ? 'Lightning invoice expired.'
              : 'Lightning payment failed.';
          onFailedRef.current(quote, message);
        }
      };

      account.wallet
        .addEventListener({
          onEvent(event) {
            if (
              event.type === 'paymentSucceeded' ||
              event.type === 'paymentFailed'
            ) {
              handlePaymentEvent(event.payment, event.type);
            }
          },
        })
        .then((listenerId) => {
          listenerCleanups.push(() => {
            account.wallet.removeEventListener(listenerId).catch(() => {
              console.warn('Failed to remove Spark event listener', {
                listenerId,
              });
            });
          });
        });

      // Initial status check for each pending quote (catches events that fired before listener)
      for (const quote of quotes) {
        account.wallet
          .getPayment({ paymentId: quote.sparkTransferId })
          .then(({ payment }) => {
            if (payment.status === 'completed') {
              handlePaymentEvent(payment, 'paymentSucceeded');
            } else if (payment.status === 'failed') {
              handlePaymentEvent(payment, 'paymentFailed');
            }
          })
          .catch((error) => {
            console.error('Error checking initial send payment status', {
              cause: error,
              sparkTransferId: quote.sparkTransferId,
            });
          });
      }
    }

    return () => {
      for (const cleanup of listenerCleanups) cleanup();
    };
  }, [sendQuotes, getSparkAccount]);
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
  return useMutation({
    mutationFn: async ({
      account,
      paymentRequest,
      amount,
    }: CreateSparkLightningSendQuoteParams) => {
      return getSdk().send.getSparkLightningSendQuote({
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
  return useMutation({
    scope: {
      id: 'create-spark-send-quote',
    },
    mutationFn: ({ account, quote }: CreateSparkSendQuoteParams) => {
      return getSdk().send.createSparkSendQuote({ account, quote });
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
 * - For UNPAID quotes: Initiates the lightning payment
 * - For PENDING quotes: Listens for Breez SDK payment events to update quote state.
 */
export function useProcessSparkSendQuoteTasks() {
  const sparkSendQuoteService = getSdk().send.internal.sparkSendQuoteService;
  const unresolvedSendQuotes = useUnresolvedSparkSendQuotes();
  const unresolvedQuotesCache = useUnresolvedSparkSendQuotesCache();
  const getSparkAccount = useGetSparkAccount();

  const { mutate: failSendQuote, isPending: isFailingSendQuote } = useMutation({
    mutationFn: async ({
      quoteId,
      reason,
    }: {
      quoteId: string;
      reason: string;
    }) => {
      const quote = unresolvedQuotesCache.get(quoteId);
      if (!quote) {
        // Quote is not pending anymore so it was removed from the cache.
        // This can happen if the quote was completed, failed or expired in the meantime.
        return;
      }

      return await sparkSendQuoteService.fail(quote, reason);
    },
    retry: 3,
    throwOnError: true,
    onSuccess: (updatedQuote) => {
      if (updatedQuote) {
        unresolvedQuotesCache.remove(updatedQuote);
      }
    },
    onError: (error, variables) => {
      console.error('Failed to mark spark send quote as failed', {
        cause: error,
        sendQuoteId: variables.quoteId,
      });
    },
  });

  const { mutate: initiateSend, isPending: isInitiatingSend } = useMutation({
    mutationFn: async (quote: SparkSendQuote) => {
      const cachedQuote = unresolvedQuotesCache.get(quote.id);
      if (cachedQuote?.state !== 'UNPAID') {
        // Quote was updated in the meantime, skip initiation.
        return;
      }

      const account = getSparkAccount(quote.accountId);
      return sparkSendQuoteService
        .initiateSend({
          account,
          sendQuote: quote,
        })
        .catch((error) => {
          if (error instanceof DomainError) {
            failSendQuote(
              {
                quoteId: quote.id,
                reason: error.message,
              },
              { scope: { id: `spark-send-quote-${quote.id}` } },
            );
            return;
          }
          throw error;
        });
    },
    retry: 3,
    throwOnError: true,
    onSuccess: (updatedQuote) => {
      if (updatedQuote) {
        unresolvedQuotesCache.update(updatedQuote);
      }
    },
    onError: (error, quote) => {
      console.error('Initiate spark send quote error', {
        cause: error,
        sendQuoteId: quote.id,
      });
    },
  });

  const { mutate: completeSendQuote, isPending: isCompletingSendQuote } =
    useMutation({
      mutationFn: async ({
        quote,
        paymentPreimage,
      }: {
        quote: SparkSendQuote;
        paymentPreimage: string;
      }) => {
        const cachedQuote = unresolvedQuotesCache.get(quote.id);
        if (!cachedQuote) {
          // Quote was updated in the meantime so it's not unresolved anymore.
          return;
        }
        return sparkSendQuoteService.complete(quote, paymentPreimage);
      },
      retry: 3,
      throwOnError: true,
      onSuccess: (updatedQuote) => {
        if (updatedQuote) {
          sparkDebugLog('Send quote completed', {
            quoteId: updatedQuote.id,
            accountId: updatedQuote.accountId,
          });
          unresolvedQuotesCache.remove(updatedQuote);
        }
      },
      onError: (error, { quote }) => {
        console.error('Complete spark send quote error', {
          cause: error,
          sendQuoteId: quote.id,
        });
      },
    });

  useOnSparkSendStateChange({
    sendQuotes: unresolvedSendQuotes,
    onUnpaid: (quote) => {
      if (!isInitiatingSend) {
        initiateSend(quote, {
          scope: { id: `spark-send-quote-${quote.id}` },
        });
      }
    },
    onCompleted: (quote, paymentData) => {
      if (!isCompletingSendQuote) {
        completeSendQuote(
          {
            quote,
            paymentPreimage: paymentData.paymentPreimage,
          },
          { scope: { id: `spark-send-quote-${quote.id}` } },
        );
      }
    },
    onFailed: (quote, failureReason) => {
      if (!isFailingSendQuote) {
        failSendQuote(
          { quoteId: quote.id, reason: failureReason },
          { scope: { id: `spark-send-quote-${quote.id}` } },
        );
      }
    },
  });
}
