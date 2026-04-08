import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import type { Money } from '~/lib/money';
import { useLatest } from '~/lib/use-latest';
import type { SparkAccount } from '../accounts/account';
import {
  useGetSparkAccount,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import type { AgicashDbSparkSendQuote } from '../agicash-db/database';
import { DomainError } from '../shared/error';
import { sparkDebugLog } from '../shared/spark';
import { useUser } from '../user/user-hooks';
import type { SparkSendQuote } from './spark-send-quote';
import { useSparkSendQuoteRepository } from './spark-send-quote-repository';
import {
  type SparkLightningQuote,
  useSparkSendQuoteService,
} from './spark-send-quote-service';

/**
 * Cache for unresolved (UNPAID or PENDING) spark send quotes.
 */
export class UnresolvedSparkSendQuotesCache {
  public static Key = 'unresolved-spark-send-quotes';

  constructor(private readonly queryClient: QueryClient) {}

  get(quoteId: string) {
    return this.queryClient
      .getQueryData<SparkSendQuote[]>([UnresolvedSparkSendQuotesCache.Key])
      ?.find((q) => q.id === quoteId);
  }

  add(quote: SparkSendQuote) {
    this.queryClient.setQueryData<SparkSendQuote[]>(
      [UnresolvedSparkSendQuotesCache.Key],
      (curr) => [...(curr ?? []), quote],
    );
  }

  update(quote: SparkSendQuote) {
    this.queryClient.setQueryData<SparkSendQuote[]>(
      [UnresolvedSparkSendQuotesCache.Key],
      (curr) =>
        curr?.map((q) =>
          q.id === quote.id && q.version < quote.version ? quote : q,
        ),
    );
  }

  remove(quote: SparkSendQuote) {
    this.queryClient.setQueryData<SparkSendQuote[]>(
      [UnresolvedSparkSendQuotesCache.Key],
      (curr) => curr?.filter((q) => q.id !== quote.id),
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [UnresolvedSparkSendQuotesCache.Key],
    });
  }
}

export function useUnresolvedSparkSendQuotesCache() {
  const queryClient = useQueryClient();
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
  const sparkSendQuoteRepository = useSparkSendQuoteRepository();

  return [
    {
      event: 'SPARK_SEND_QUOTE_CREATED',
      handleEvent: async (payload: AgicashDbSparkSendQuote) => {
        const addedQuote = await sparkSendQuoteRepository.toQuote(payload);
        unresolvedQuotesCache.add(addedQuote);
      },
    },
    {
      event: 'SPARK_SEND_QUOTE_UPDATED',
      handleEvent: async (payload: AgicashDbSparkSendQuote) => {
        const quote = await sparkSendQuoteRepository.toQuote(payload);

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

const useUnresolvedSparkSendQuotes = () => {
  const sparkSendQuoteRepository = useSparkSendQuoteRepository();
  const userId = useUser((user) => user.id);
  const selectWithOnlineAccount = useSelectItemsWithOnlineAccount();

  const { data } = useQuery({
    queryKey: [UnresolvedSparkSendQuotesCache.Key],
    queryFn: () => sparkSendQuoteRepository.getUnresolved(userId),
    staleTime: Number.POSITIVE_INFINITY,
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

  const lastTriggeredStateRef = useRef<Map<string, SparkSendQuote['state']>>(
    new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    const listenerCleanups: (() => void)[] = [];

    const quoteIds = sendQuotes.map((q) => q.id);
    const quoteIdSet = new Set(quoteIds);

    // Clean up tracked states for removed quotes
    for (const trackedQuoteId of lastTriggeredStateRef.current.keys()) {
      if (!quoteIdSet.has(trackedQuoteId)) {
        lastTriggeredStateRef.current.delete(trackedQuoteId);
      }
    }

    if (quoteIds.length === 0) return;

    // Handle UNPAID quotes immediately
    for (const quote of sendQuotes) {
      if (
        quote.state === 'UNPAID' &&
        lastTriggeredStateRef.current.get(quote.id) !== 'UNPAID'
      ) {
        lastTriggeredStateRef.current.set(quote.id, 'UNPAID');
        onUnpaidRef.current(quote);
      }
    }

    // Group PENDING quotes by account for efficient listener registration
    const pendingQuotesByAccount = new Map<string, SparkSendQuote[]>();
    for (const quote of sendQuotes) {
      if (quote.state !== 'PENDING') continue;
      const existing = pendingQuotesByAccount.get(quote.accountId) ?? [];
      existing.push(quote);
      pendingQuotesByAccount.set(quote.accountId, existing);
    }

    // Register one listener per account
    for (const [accountId, quotes] of pendingQuotesByAccount) {
      const account = getSparkAccount(accountId);
      const sdk = account.wallet;
      const sparkIds = new Set(quotes.map((q) => q.sparkId));

      const handlePaymentEvent = (
        payment: {
          id: string;
          details?: { type: string; htlcDetails?: { preimage?: string } };
        },
        eventType: string,
      ) => {
        if (!sparkIds.has(payment.id)) return;
        const quote = quotes.find((q) => q.sparkId === payment.id);
        if (!quote) return;

        if (
          eventType === 'paymentSucceeded' &&
          lastTriggeredStateRef.current.get(quote.id) !== 'COMPLETED'
        ) {
          const preimage = payment.details?.htlcDetails?.preimage;
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

      sdk
        .addEventListener({
          onEvent(event) {
            if (cancelled) return;
            if (
              event.type === 'paymentSucceeded' ||
              event.type === 'paymentFailed'
            ) {
              handlePaymentEvent(event.payment, event.type);
            }
          },
        })
        .then((listenerId) => {
          if (cancelled) {
            // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional fire-and-forget cleanup
            sdk.removeEventListener(listenerId).catch(() => {});
            return;
          }
          listenerCleanups.push(() => {
            // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional fire-and-forget cleanup
            sdk.removeEventListener(listenerId).catch(() => {});
          });
        });

      // Initial status check for each pending quote (catches events that fired before listener)
      for (const quote of quotes) {
        sdk
          .getPayment({ paymentId: quote.sparkId })
          .then((response) => {
            if (cancelled) return;
            const payment = response.payment;
            if (!payment) return;
            if (payment.status === 'completed') {
              handlePaymentEvent(payment, 'paymentSucceeded');
            } else if (payment.status === 'failed') {
              handlePaymentEvent(payment, 'paymentFailed');
            }
          })
          .catch((error) => {
            console.error('Error checking initial send payment status', {
              cause: error,
              sparkId: quote.sparkId,
            });
          });
      }
    }

    return () => {
      cancelled = true;
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
 * - For UNPAID quotes: Initiates the lightning payment
 * - For PENDING quotes: Listens for Breez SDK payment events to update quote state.
 */
export function useProcessSparkSendQuoteTasks() {
  const sparkSendQuoteService = useSparkSendQuoteService();
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
