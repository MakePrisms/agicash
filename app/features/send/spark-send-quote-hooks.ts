import type { Payment } from '@agicash/breez-sdk-spark';
import * as Sentry from '@sentry/react-router';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type Big from 'big.js';
import { useEffect, useMemo, useRef } from 'react';
import { Money } from '~/lib/money';
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
  type SparkSendCompletionExtras,
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
  /**
   * Called when a quote's payment is completed.
   * For BTC accounts this fires once, on the single lightning settlement.
   * For USD accounts this fires once, after the lightning leg settles;
   * `extras` then carries the earlier conversion-leg amounts and fees.
   */
  onCompleted: (
    quote: SparkSendQuote,
    paymentData: {
      paymentPreimage: string;
      extras?: SparkSendCompletionExtras;
    },
  ) => void;
  onFailed: (quote: SparkSendQuote, failureReason: string) => void;
};

/**
 * Extracts the bolt11 invoice carried on a Payment, across the discriminated
 * union of detail shapes. For `'lightning'` it's `details.invoice`; for
 * `'spark' | 'token'` it's `details.invoiceDetails?.invoice` (the SDK populates
 * this for conversion legs that originated from a lightning send).
 */
function getPaymentInvoice(payment: Payment): string | undefined {
  const details = payment.details;
  if (!details) return undefined;
  if (details.type === 'lightning') return details.invoice;
  if (details.type === 'spark' || details.type === 'token') {
    return details.invoiceDetails?.invoice;
  }
  return undefined;
}

/**
 * Extracts the lightning preimage from a Payment's details, when present.
 */
function getPaymentPreimage(payment: Payment): string | undefined {
  const details = payment.details;
  if (!details) return undefined;
  if (details.type === 'lightning') return details.htlcDetails.preimage;
  if (details.type === 'spark') return details.htlcDetails?.preimage;
  return undefined;
}

/**
 * Hook that fires callbacks when the state of a send quote changes.
 *
 * Uses event-driven approach via Breez SDK event listeners.
 * One listener per Spark account is registered. An initial status check
 * is performed for each pending quote to catch events that fired before
 * the listener was registered.
 *
 * For USD-account sends the SDK fires two `paymentSucceeded` events: the
 * USDB → sats conversion leg first, then the Lightning leg. The hook caches
 * conversion-leg extras and only marks the quote COMPLETED after the
 * Lightning leg succeeds, then forwards both together to `onCompleted`.
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

  // Cache conversion-leg extras captured for a USD-account send while we wait
  // for the lightning leg to finish. Cleared on completion AND on
  // failure/refund paths so the per-quote entry never outlives the quote.
  const usdConversionExtrasByQuoteIdRef = useRef<
    Map<string, SparkSendCompletionExtras>
  >(new Map());

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
    for (const trackedQuoteId of usdConversionExtrasByQuoteIdRef.current.keys()) {
      if (!quoteIdSet.has(trackedQuoteId)) {
        usdConversionExtrasByQuoteIdRef.current.delete(trackedQuoteId);
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
      const isUsdAccount = account.currency === 'USD';
      const quoteByTransferId = new Map(
        quotes.map((q) => [q.sparkTransferId, q]),
      );
      const quoteByPaymentRequest = new Map(
        quotes.map((q) => [q.paymentRequest, q]),
      );

      const findQuote = (payment: Payment): PendingQuote | undefined => {
        const match = quoteByTransferId.get(payment.id);
        if (match) return match;
        const invoice = getPaymentInvoice(payment);
        if (invoice) return quoteByPaymentRequest.get(invoice);
        return undefined;
      };

      const completeWithExtras = (quote: PendingQuote, preimage: string) => {
        const extras = usdConversionExtrasByQuoteIdRef.current.get(quote.id);
        usdConversionExtrasByQuoteIdRef.current.delete(quote.id);
        lastTriggeredStateRef.current.set(quote.id, 'COMPLETED');
        sparkDebugLog('Send payment detected as completed', {
          quoteId: quote.id,
          accountId,
        });
        onCompletedRef.current(quote, { paymentPreimage: preimage, extras });
      };

      const handlePaymentSucceeded = (payment: Payment) => {
        const quote = findQuote(payment);
        if (!quote) return;
        if (lastTriggeredStateRef.current.get(quote.id) === 'COMPLETED') {
          return;
        }

        // BTC account: single-event completion path, unchanged.
        if (!isUsdAccount) {
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
          completeWithExtras(quote, preimage);
          return;
        }

        // USD account: two-leg dispatch.
        // The SDK fires `paymentSucceeded` for both the USDB → sats conversion
        // leg and the lightning leg. The conversion-leg Payment carries
        // `conversionDetails`; the lightning-leg carries `details.type ===
        // 'lightning'` with `htlcDetails.preimage`. We complete only after the
        // lightning leg, folding the cached conversion-leg extras in.
        const conv = payment.conversionDetails;
        const conversionStatus = conv?.status;
        const isConversionLeg =
          conversionStatus !== undefined && conversionStatus !== 'pending';

        if (isConversionLeg) {
          if (conversionStatus === 'completed') {
            // `ConversionStep.to.amount` is the sats produced by the swap
            // (input to the lightning leg). `from.amount` is the USDB raw
            // amount actually debited — we already estimated this at quote
            // creation time, so it's not re-stored here. The storage layer
            // can emit `{from: null, to: null}` for legacy/replayed payments;
            // fall back to `payment.amount`/`payment.fees`.
            const toSats = conv?.to?.amount;
            const fromFee = conv?.from?.fee ?? 0n;
            const toFee = conv?.to?.fee ?? 0n;
            const conversionFeeSats =
              conv?.from || conv?.to ? fromFee + toFee : payment.fees;
            const satsAfterConversion: Money | undefined =
              toSats !== undefined
                ? (new Money({
                    amount: toSats.toString(),
                    currency: 'BTC',
                    unit: 'sat',
                  }) as Money)
                : (new Money({
                    amount: payment.amount.toString(),
                    currency: 'BTC',
                    unit: 'sat',
                  }) as Money);
            const conversionFee: Money = new Money({
              amount: conversionFeeSats.toString(),
              currency: 'BTC',
              unit: 'sat',
            }) as Money;

            usdConversionExtrasByQuoteIdRef.current.set(quote.id, {
              satsAfterConversion,
              conversionFee,
              // `slippageActual` would be the (estimated USDB → sats output
              // minus actual sats output). The current quote shape doesn't
              // persist the quote-time estimate, so we leave this undefined
              // for the MVP. See docs/superpowers/plans/2026-05-21-spark-usdb.md
              // Task 8.
              slippageActual: undefined,
            });
            sparkDebugLog('USD send conversion leg completed', {
              quoteId: quote.id,
              accountId,
              paymentId: payment.id,
            });
            return;
          }

          if (
            conversionStatus === 'failed' ||
            conversionStatus === 'refundNeeded'
          ) {
            usdConversionExtrasByQuoteIdRef.current.delete(quote.id);
            // Conversion failed mid-send. If the lightning leg already
            // settled (or has yet to start), the USDB has been debited and
            // sats may now be sitting in the wallet's sats balance ("dangling
            // sats"). Leave the quote PENDING; surface to Sentry per the
            // design doc.
            console.error('Spark USD send conversion needs attention', {
              paymentId: payment.id,
              quoteId: quote.id,
              conversionStatus,
            });
            Sentry.captureException(
              new Error(`Spark USD send conversion ${conversionStatus}`),
              {
                tags: {
                  'spark.usd.dangling_sats': 'true',
                  'spark.usd.conversion_status': conversionStatus,
                },
                extra: {
                  quoteId: quote.id,
                  accountId,
                  paymentId: payment.id,
                  conversionDetails: conv,
                },
              },
            );
            return;
          }

          // `refunded` — operator-driven terminal state. Drop the cache; the
          // quote stays PENDING until a separate code path resolves it.
          if (conversionStatus === 'refunded') {
            usdConversionExtrasByQuoteIdRef.current.delete(quote.id);
          }
          return;
        }

        // Lightning leg of a USD send.
        const preimage = getPaymentPreimage(payment);
        if (!preimage) {
          console.error('USD send lightning leg succeeded but no preimage', {
            paymentId: payment.id,
            quoteId: quote.id,
          });
          return;
        }
        completeWithExtras(quote, preimage);
      };

      const handlePaymentFailed = (payment: Payment) => {
        const quote = findQuote(payment);
        if (!quote) return;
        if (lastTriggeredStateRef.current.get(quote.id) === 'FAILED') {
          return;
        }
        // Ignore the conversion-leg failed/refundNeeded path here — that
        // surfaces through `handlePaymentSucceeded`'s conversion-status
        // dispatch with `payment.status === 'completed'` on the parent. A
        // `paymentFailed` event at this level means the lightning leg failed
        // and the quote should be marked FAILED.
        lastTriggeredStateRef.current.set(quote.id, 'FAILED');
        usdConversionExtrasByQuoteIdRef.current.delete(quote.id);
        const message =
          quote.expiresAt && new Date(quote.expiresAt) < new Date()
            ? 'Lightning invoice expired.'
            : 'Lightning payment failed.';
        onFailedRef.current(quote, message);
      };

      account.wallet
        .addEventListener({
          onEvent(event) {
            if (event.type === 'paymentSucceeded') {
              handlePaymentSucceeded(event.payment);
            } else if (event.type === 'paymentPending' && isUsdAccount) {
              // USD: pending events can carry `conversionDetails` for
              // in-flight conversion state (failed/refundNeeded) before any
              // `paymentSucceeded` arrives.
              handlePaymentSucceeded(event.payment);
            } else if (event.type === 'paymentFailed') {
              handlePaymentFailed(event.payment);
            }
          },
        })
        .then((listenerId) => {
          listenerCleanups.push(() => {
            account.wallet.removeEventListener(listenerId).catch((err) => {
              console.warn('Failed to remove Spark event listener', err);
            });
          });
        });

      // Initial status check for each pending quote (catches events that fired before listener)
      for (const quote of quotes) {
        account.wallet
          .getPayment({ paymentId: quote.sparkTransferId })
          .then(({ payment }) => {
            if (payment.status === 'completed') {
              handlePaymentSucceeded(payment);
            } else if (payment.status === 'failed') {
              handlePaymentFailed(payment);
            } else if (payment.status === 'pending' && isUsdAccount) {
              // For USD: still in flight; surface conversion-leg state if any.
              handlePaymentSucceeded(payment);
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
  /**
   * Required when paying an amountless invoice from a USD source account.
   * Rate is in `USD-BTC` format (multiply USD cents by rate to get sats).
   */
  exchangeRate?: Big | string;
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
      exchangeRate,
    }: CreateSparkLightningSendQuoteParams) => {
      return sparkSendQuoteService.getLightningSendQuote({
        account,
        paymentRequest,
        amount,
        exchangeRate,
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
        extras,
      }: {
        quote: SparkSendQuote;
        paymentPreimage: string;
        extras?: SparkSendCompletionExtras;
      }) => {
        const cachedQuote = unresolvedQuotesCache.get(quote.id);
        if (!cachedQuote) {
          // Quote was updated in the meantime so it's not unresolved anymore.
          return;
        }
        return sparkSendQuoteService.complete(quote, paymentPreimage, extras);
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
            extras: paymentData.extras,
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
