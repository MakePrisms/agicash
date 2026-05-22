import type { Payment } from '@agicash/breez-sdk-spark';
import { MintOperationError, NetworkError } from '@cashu/cashu-ts';
import * as Sentry from '@sentry/react-router';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type Big from 'big.js';
import { useEffect, useMemo, useRef } from 'react';
import {
  type ExtendedCashuWallet,
  getCashuUnit,
  getCashuWallet,
  sumProofs,
  useOnMeltQuoteStateChange,
} from '~/lib/cashu';
import { Money } from '~/lib/money';
import { convertUsdbToMoney } from '~/lib/spark';
import { useLatest } from '~/lib/use-latest';
import type { SparkAccount } from '../accounts/account';
import {
  useGetCashuAccountByMintUrlAndCurrency,
  useGetSparkAccount,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import type { AgicashDbSparkReceiveQuote } from '../agicash-db/database';
import { getInitializedCashuWallet } from '../shared/cashu';
import { sparkDebugLog } from '../shared/spark';
import type { TransactionPurpose } from '../transactions/transaction-enums';
import { useTransactionsCache } from '../transactions/transaction-hooks';
import { useUser } from '../user/user-hooks';
import type { SparkReceiveQuote } from './spark-receive-quote';
import { getLightningQuote } from './spark-receive-quote-core';
import { useSparkReceiveQuoteRepository } from './spark-receive-quote-repository';
import {
  type SparkReceiveCompletionExtras,
  useSparkReceiveQuoteService,
} from './spark-receive-quote-service';

class SparkReceiveQuoteCache {
  // Query that tracks the "active" spark receive quote. Active one is the one that user created in current browser session.
  // We want to track active quote even after it is expired and completed which is why we can't use pending quotes query.
  // Pending quotes query is used for active pending quote plus "background" pending quotes. "Background" quotes are quotes
  // that were created in previous browser sessions.
  public static Key = 'spark-receive-quote';

  constructor(private readonly queryClient: QueryClient) {}

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [SparkReceiveQuoteCache.Key],
    });
  }

  add(quote: SparkReceiveQuote) {
    this.queryClient.setQueryData<SparkReceiveQuote>(
      [SparkReceiveQuoteCache.Key, quote.id],
      quote,
    );
  }

  updateIfExists(quote: SparkReceiveQuote) {
    this.queryClient.setQueryData<SparkReceiveQuote>(
      [SparkReceiveQuoteCache.Key, quote.id],
      (curr) => (curr && curr.version < quote.version ? quote : undefined),
    );
  }
}

export function useSparkReceiveQuoteCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new SparkReceiveQuoteCache(queryClient), [queryClient]);
}

type UseSparkReceiveQuoteProps = {
  quoteId?: string;
  onPaid?: (quote: SparkReceiveQuote) => void;
  onExpired?: (quote: SparkReceiveQuote) => void;
};

type UseSparkReceiveQuoteResponse =
  | {
      status: 'LOADING';
      quote?: undefined;
    }
  | {
      status: SparkReceiveQuote['state'];
      quote: SparkReceiveQuote;
    };

export function useSparkReceiveQuote({
  quoteId,
  onPaid,
  onExpired,
}: UseSparkReceiveQuoteProps): UseSparkReceiveQuoteResponse {
  const enabled = !!quoteId;
  const onPaidRef = useLatest(onPaid);
  const onExpiredRef = useLatest(onExpired);
  const sparkReceiveQuoteRepository = useSparkReceiveQuoteRepository();

  const { data } = useQuery({
    queryKey: [SparkReceiveQuoteCache.Key, quoteId],
    // biome-ignore lint/style/noNonNullAssertion: quoteId is guaranteed by enabled
    queryFn: () => sparkReceiveQuoteRepository.get(quoteId!),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    enabled,
  });

  useEffect(() => {
    if (!data) return;

    if (data.state === 'PAID') {
      onPaidRef.current?.(data);
    } else if (data.state === 'EXPIRED') {
      onExpiredRef.current?.(data);
    }
  }, [data]);

  if (!data) {
    return { status: 'LOADING' };
  }

  return {
    status: data.state,
    quote: data,
  };
}

export class PendingSparkReceiveQuotesCache {
  public static Key = 'pending-spark-receive-quotes';

  constructor(private readonly queryClient: QueryClient) {}

  get(quoteId: string) {
    return this.queryClient
      .getQueryData<SparkReceiveQuote[]>([PendingSparkReceiveQuotesCache.Key])
      ?.find((q) => q.id === quoteId);
  }

  getByMeltQuoteId(
    meltQuoteId: string,
  ): (SparkReceiveQuote & { type: 'CASHU_TOKEN' }) | undefined {
    const quotes = this.queryClient.getQueryData<SparkReceiveQuote[]>([
      PendingSparkReceiveQuotesCache.Key,
    ]);
    return quotes?.find(
      (q): q is SparkReceiveQuote & { type: 'CASHU_TOKEN' } =>
        q.type === 'CASHU_TOKEN' &&
        q.tokenReceiveData.meltQuoteId === meltQuoteId,
    );
  }

  add(quote: SparkReceiveQuote) {
    this.queryClient.setQueryData<SparkReceiveQuote[]>(
      [PendingSparkReceiveQuotesCache.Key],
      (curr) => [...(curr ?? []), quote],
    );
  }

  update(quote: SparkReceiveQuote) {
    this.queryClient.setQueryData<SparkReceiveQuote[]>(
      [PendingSparkReceiveQuotesCache.Key],
      (curr) =>
        curr?.map((q) =>
          q.id === quote.id && q.version < quote.version ? quote : q,
        ),
    );
  }

  remove(quote: SparkReceiveQuote) {
    this.queryClient.setQueryData<SparkReceiveQuote[]>(
      [PendingSparkReceiveQuotesCache.Key],
      (curr) => curr?.filter((q) => q.id !== quote.id),
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [PendingSparkReceiveQuotesCache.Key],
    });
  }
}

export function usePendingSparkReceiveQuotesCache() {
  const queryClient = useQueryClient();
  return useMemo(
    () => new PendingSparkReceiveQuotesCache(queryClient),
    [queryClient],
  );
}

/**
 * Hook that returns spark receive quote change handlers.
 */
export function useSparkReceiveQuoteChangeHandlers() {
  const pendingQuotesCache = usePendingSparkReceiveQuotesCache();
  const sparkReceiveQuoteCache = useSparkReceiveQuoteCache();
  const sparkReceiveQuoteRepository = useSparkReceiveQuoteRepository();

  return [
    {
      event: 'SPARK_RECEIVE_QUOTE_CREATED',
      handleEvent: async (payload: AgicashDbSparkReceiveQuote) => {
        const addedQuote = await sparkReceiveQuoteRepository.toQuote(payload);
        pendingQuotesCache.add(addedQuote);
      },
    },
    {
      event: 'SPARK_RECEIVE_QUOTE_UPDATED',
      handleEvent: async (payload: AgicashDbSparkReceiveQuote) => {
        const quote = await sparkReceiveQuoteRepository.toQuote(payload);

        sparkReceiveQuoteCache.updateIfExists(quote);

        const isQuoteStillPending = quote.state === 'UNPAID';
        if (isQuoteStillPending) {
          pendingQuotesCache.update(quote);
        } else {
          pendingQuotesCache.remove(quote);
        }
      },
    },
  ];
}

const usePendingSparkReceiveQuotes = () => {
  const sparkReceiveQuoteRepository = useSparkReceiveQuoteRepository();
  const userId = useUser((user) => user.id);
  const selectWithOnlineAccount = useSelectItemsWithOnlineAccount();

  const { data } = useQuery({
    queryKey: [PendingSparkReceiveQuotesCache.Key],
    queryFn: () => sparkReceiveQuoteRepository.getPending(userId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    throwOnError: true,
    select: selectWithOnlineAccount,
  });

  return data ?? [];
};

const usePendingMeltQuotes = () => {
  const pendingSparkReceiveQuotes = usePendingSparkReceiveQuotes();
  return useMemo(
    () =>
      pendingSparkReceiveQuotes
        .filter(
          (q): q is SparkReceiveQuote & { type: 'CASHU_TOKEN' } =>
            q.type === 'CASHU_TOKEN',
        )
        .map((q) => ({
          id: q.tokenReceiveData.meltQuoteId,
          mintUrl: q.tokenReceiveData.sourceMintUrl,
          currency: q.tokenReceiveData.tokenAmount.currency,
          expiryInMs: new Date(q.expiresAt).getTime(),
          inputAmount: sumProofs(q.tokenReceiveData.tokenProofs),
        })),
    [pendingSparkReceiveQuotes],
  );
};

type CreateProps = {
  /**
   * The Spark account to create the receive request for.
   */
  account: SparkAccount;
  /**
   * The amount to receive, denominated in the account's currency.
   */
  amount: Money;
  /**
   * Description to include in the Lightning invoice memo.
   */
  description?: string;
  /**
   * Required for USD accounts. Rate is in `USD-BTC` format (multiply USD cents
   * by rate to get sats) — see `~/hooks/use-exchange-rate.ts`.
   */
  exchangeRate?: Big | string;
  /**
   * The purpose of this transaction (e.g. a Cash App buy).
   */
  purpose?: TransactionPurpose;
  /**
   * UUID linking paired send/receive transactions in a transfer.
   */
  transferId?: string;
};

/**
 * Returns a mutation for creating a Spark receive quote.
 * The quote is stored in the database and will be tracked by the background task processor.
 */
export function useCreateSparkReceiveQuote() {
  const userId = useUser((user) => user.id);
  const sparkReceiveQuoteService = useSparkReceiveQuoteService();
  const sparkReceiveQuoteCache = useSparkReceiveQuoteCache();

  return useMutation({
    scope: {
      id: 'create-spark-receive-quote',
    },
    mutationFn: async ({
      account,
      amount,
      description,
      exchangeRate,
      purpose,
      transferId,
    }: CreateProps) => {
      const lightningQuote = await getLightningQuote({
        wallet: account.wallet,
        amount,
        accountCurrency: account.currency,
        exchangeRate,
        description,
      });

      return sparkReceiveQuoteService.createReceiveQuote({
        userId,
        account,
        lightningQuote,
        receiveType: 'LIGHTNING',
        purpose,
        transferId,
      });
    },
    onSuccess: (data) => {
      sparkReceiveQuoteCache.add(data);
    },
    retry: 1,
  });
}

type OnSparkReceiveStateChangeCallbacks = {
  /**
   * Called when a quote's payment is completed.
   * For BTC accounts this fires once, on the single lightning settlement.
   * For USD accounts this fires once, after the sats → USDB conversion leg
   * settles; `extras` then carries the conversion-leg amounts and fees.
   */
  onCompleted: (
    quoteId: string,
    paymentData: {
      paymentPreimage: string;
      sparkTransferId: string;
      extras?: SparkReceiveCompletionExtras;
    },
  ) => void;
  /**
   * Called when a quote expires without being paid.
   */
  onExpired: (quoteId: string) => void;
};

/**
 * Extracts the bolt11 invoice carried on a Payment, across the discriminated
 * union of detail shapes. For `'lightning'` it's `details.invoice`; for
 * `'spark' | 'token'` it's `details.invoiceDetails?.invoice` (the SDK populates
 * this for conversion legs that originated from a lightning receive).
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
 * Extracts the payment hash from a Payment's details, when present.
 * Available on `'lightning'` always; on `'spark'` when an HTLC was involved.
 */
function getPaymentHash(payment: Payment): string | undefined {
  const details = payment.details;
  if (!details) return undefined;
  if (details.type === 'lightning') return details.htlcDetails.paymentHash;
  if (details.type === 'spark') return details.htlcDetails?.paymentHash;
  return undefined;
}

/**
 * Extracts the preimage from a Payment's details, when present.
 * Available on `'lightning'` and `'spark'` (via `htlcDetails.preimage`).
 */
function getPaymentPreimage(payment: Payment): string | undefined {
  const details = payment.details;
  if (!details) return undefined;
  if (details.type === 'lightning') return details.htlcDetails.preimage;
  if (details.type === 'spark') return details.htlcDetails?.preimage;
  return undefined;
}

export function useOnSparkReceiveStateChange({
  onCompleted,
  onExpired,
}: OnSparkReceiveStateChangeCallbacks) {
  const pendingQuotes = usePendingSparkReceiveQuotes();
  const getSparkAccount = useGetSparkAccount();

  const onCompletedRef = useLatest(onCompleted);
  const onExpiredRef = useLatest(onExpired);

  // Cache (preimage, sparkTransferId) captured during the lightning leg of a
  // USD-account receive so the conversion-leg event can read them back when it
  // completes the quote. Keyed by quoteId; only populated for USD accounts.
  const usdPreimageByQuoteIdRef = useRef<
    Map<string, { paymentPreimage: string; sparkTransferId: string }>
  >(new Map());

  useEffect(() => {
    if (pendingQuotes.length === 0) return;

    // Group pending quotes by account for one listener per SDK instance
    const quotesByAccount = new Map<string, SparkReceiveQuote[]>();
    for (const quote of pendingQuotes) {
      const existing = quotesByAccount.get(quote.accountId);
      if (existing) {
        existing.push(quote);
      } else {
        quotesByAccount.set(quote.accountId, [quote]);
      }
    }

    const registrations: {
      wallet: SparkAccount['wallet'];
      listenerPromise: Promise<string>;
    }[] = [];

    for (const [accountId, quotes] of quotesByAccount) {
      const account = getSparkAccount(accountId);
      const isUsdAccount = account.currency === 'USD';

      const quoteByPaymentHash = new Map(quotes.map((q) => [q.paymentHash, q]));
      const quoteByPaymentRequest = new Map(
        quotes.map((q) => [q.paymentRequest, q]),
      );

      const findQuote = (payment: Payment): SparkReceiveQuote | undefined => {
        const hash = getPaymentHash(payment);
        if (hash) {
          const match = quoteByPaymentHash.get(hash);
          if (match) return match;
        }
        const invoice = getPaymentInvoice(payment);
        if (invoice) return quoteByPaymentRequest.get(invoice);
        return undefined;
      };

      const handlePayment = (payment: Payment) => {
        const quote = findQuote(payment);
        if (!quote) return;

        // BTC account: single-event completion path, unchanged.
        if (!isUsdAccount) {
          const details = payment.details;
          if (details?.type !== 'lightning') return;
          const preimage = details.htlcDetails.preimage;
          if (!preimage) {
            console.error('Receive payment succeeded but no preimage', {
              paymentId: payment.id,
              quoteId: quote.id,
            });
            return;
          }

          sparkDebugLog('Receive payment detected as completed', {
            quoteId: quote.id,
            accountId,
            sparkTransferId: payment.id,
          });
          onCompletedRef.current(quote.id, {
            sparkTransferId: payment.id,
            paymentPreimage: preimage,
          });
          return;
        }

        // USD account: dispatch on the leg.
        //
        // The Breez SDK reports each settlement as a `paymentSucceeded` with a
        // `Payment` object. For a stable-balance receive, the lightning leg
        // settles first (sats credited), then Flashnet runs the sats → USDB
        // conversion. The conversion leg's `Payment` carries
        // `conversionDetails.status` and the post-conversion amounts.
        const conv = payment.conversionDetails;
        const conversionStatus = conv?.status;
        const isConversionLeg =
          conversionStatus !== undefined && conversionStatus !== 'pending';

        if (!isConversionLeg) {
          // Lightning leg — stash preimage so the conversion leg can complete
          // the quote with it. Quote stays UNPAID; only an in-memory cache
          // update happens here. Persistence of the sats amount waits for the
          // conversion leg, when we know the full picture.
          const preimage = getPaymentPreimage(payment);
          if (preimage) {
            usdPreimageByQuoteIdRef.current.set(quote.id, {
              paymentPreimage: preimage,
              sparkTransferId: payment.id,
            });
          }
          sparkDebugLog('USD receive lightning leg observed', {
            quoteId: quote.id,
            accountId,
            paymentId: payment.id,
            conversionStatus: conversionStatus ?? null,
          });
          return;
        }

        if (conversionStatus === 'completed') {
          const cached = usdPreimageByQuoteIdRef.current.get(quote.id);
          const preimage = getPaymentPreimage(payment) ?? cached?.paymentPreimage;
          if (!preimage) {
            // We never saw the lightning leg's preimage (e.g. initial-status
            // catch-up where the SDK already merged the legs and dropped the
            // preimage). Without one, completing the quote would violate the
            // PAID schema invariant. Leave the quote PENDING and surface to
            // Sentry — the operator should investigate.
            console.error(
              'USD receive conversion completed but preimage unknown',
              { paymentId: payment.id, quoteId: quote.id },
            );
            Sentry.captureException(
              new Error('Spark USD receive completed without preimage'),
              {
                tags: { 'spark.usd.conversion_status': conversionStatus },
                extra: {
                  quoteId: quote.id,
                  accountId,
                  paymentId: payment.id,
                },
              },
            );
            return;
          }

          // Conversion-leg amounts. The SDK's `ConversionStep` carries the
          // pre/post amounts and per-step fees in base units (sats for the
          // bitcoin leg, raw token base units for the USDB leg). When the
          // storage layer didn't preserve `from`/`to` (it can emit
          // `{from: null, to: null}` for legacy payments) we fall back to the
          // `Payment.amount`/`Payment.fees` aggregates.
          const fromSats = conv?.from?.amount;
          const toRawUsdb = conv?.to?.amount;
          const fromFee = conv?.from?.fee ?? 0n;
          const toFee = conv?.to?.fee ?? 0n;
          const conversionFeeSats =
            conv?.from || conv?.to ? fromFee + toFee : payment.fees;
          // `Money` values are widened to the generic `Money` to match the
          // encrypted-blob schema's `z.instanceof(Money)`. The widening is safe
          // — sats/cents are tracked via `unit`/`currency` at runtime; same
          // pattern as `lightning-address-service.ts:186`.
          const bolt11AmountSats: Money | undefined =
            fromSats !== undefined
              ? (new Money({
                  amount: fromSats.toString(),
                  currency: 'BTC',
                  unit: 'sat',
                }) as Money)
              : cached
                ? // No `from`: use the lightning leg's gross sats (`payment.amount`
                  // on this conversion leg approximates the same value when the
                  // SDK collapses legs).
                  (new Money({
                    amount: payment.amount.toString(),
                    currency: 'BTC',
                    unit: 'sat',
                  }) as Money)
                : undefined;
          const usdbAmountReceived: Money | undefined =
            toRawUsdb !== undefined
              ? (convertUsdbToMoney(toRawUsdb) as Money)
              : undefined;
          const conversionFee: Money = new Money({
            amount: conversionFeeSats.toString(),
            currency: 'BTC',
            unit: 'sat',
          }) as Money;

          sparkDebugLog('USD receive conversion completed', {
            quoteId: quote.id,
            accountId,
            paymentId: payment.id,
          });
          usdPreimageByQuoteIdRef.current.delete(quote.id);
          onCompletedRef.current(quote.id, {
            sparkTransferId: cached?.sparkTransferId ?? payment.id,
            paymentPreimage: preimage,
            extras: {
              bolt11AmountSats,
              conversionFee,
              // `slippageDelta` is only meaningful when we recorded an estimate
              // at quote-creation time; the current quote shape doesn't carry
              // an estimate, so this stays undefined for the MVP. See
              // docs/superpowers/plans/2026-05-21-spark-usdb.md Task 6.
              slippageDelta: undefined,
              usdbAmountReceived,
            },
          });
          return;
        }

        if (
          conversionStatus === 'failed' ||
          conversionStatus === 'refundNeeded'
        ) {
          // Conversion failed or needs operator action. The lightning leg has
          // already credited sats to the account; leaving the quote UNPAID
          // surfaces the discrepancy in the dashboard while the operator
          // reconciles. Sentry tag matches the design doc's signal.
          console.error('Spark USD conversion needs attention', {
            paymentId: payment.id,
            quoteId: quote.id,
            conversionStatus,
          });
          Sentry.captureException(
            new Error(`Spark USD conversion ${conversionStatus}`),
            {
              tags: {
                'spark.usd.conversion_refund_needed':
                  conversionStatus === 'refundNeeded' ? 'true' : 'false',
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

        // `refunded` is a terminal state the operator triggers; nothing for
        // the wallet client to do here.
      };

      // Register event listener before initial check to avoid race conditions
      const listenerPromise = account.wallet.addEventListener({
        onEvent(event) {
          if (event.type === 'paymentSucceeded') {
            handlePayment(event.payment);
          } else if (event.type === 'paymentPending' && isUsdAccount) {
            // USD accounts: a `paymentPending` event with `conversionDetails`
            // set carries the in-flight conversion state (e.g. failed,
            // refundNeeded) before the final `paymentSucceeded` arrives.
            // For BTC accounts we ignore pending events as before — only
            // `paymentSucceeded` should complete a receive quote.
            handlePayment(event.payment);
          } else if (event.type === 'synced') {
            for (const quote of quotes) {
              if (new Date(quote.expiresAt) < new Date()) {
                onExpiredRef.current(quote.id);
              }
            }
          }
        },
      });
      registrations.push({ wallet: account.wallet, listenerPromise });

      // Initial status check per quote using local lookup (no network call)
      for (const quote of quotes) {
        account.wallet
          .getPaymentByInvoice({ invoice: quote.paymentRequest })
          .then((response) => {
            if (response.payment && response.payment.status === 'completed') {
              handlePayment(response.payment);
            }
          })
          .catch((error) => {
            console.error('Error checking initial receive payment', {
              cause: error,
              accountId,
              quoteId: quote.id,
            });
          });
      }
    }

    return () => {
      for (const { wallet, listenerPromise } of registrations) {
        listenerPromise
          .then((id) => wallet.removeEventListener(id))
          .catch(() => {
            () => {
              console.warn('Failed to remove Spark event listener');
            };
          });
      }
    };
  }, [pendingQuotes, getSparkAccount]);
}

/**
 * Hook that processes pending spark receive quotes.
 * Polls the Spark API to check for payment status and updates quotes accordingly.
 */
export function useProcessSparkReceiveQuoteTasks() {
  const sparkReceiveQuoteService = useSparkReceiveQuoteService();
  const pendingMeltQuotes = usePendingMeltQuotes();
  const getCashuAccountByMintUrlAndCurrency =
    useGetCashuAccountByMintUrlAndCurrency();
  const pendingQuotesCache = usePendingSparkReceiveQuotesCache();
  const sparkReceiveQuoteCache = useSparkReceiveQuoteCache();
  const transactionsCache = useTransactionsCache();
  const queryClient = useQueryClient();

  const { mutate: completeReceiveQuote } = useMutation({
    mutationFn: async ({
      quoteId,
      paymentPreimage,
      sparkTransferId,
      extras,
    }: {
      quoteId: string;
      paymentPreimage: string;
      sparkTransferId: string;
      extras?: SparkReceiveCompletionExtras;
    }) => {
      const quote = pendingQuotesCache.get(quoteId);
      if (!quote) {
        // Quote was updated in the meantime so it's not pending anymore.
        return;
      }
      return sparkReceiveQuoteService.complete(
        quote,
        paymentPreimage,
        sparkTransferId,
        extras,
      );
    },
    retry: 3,
    throwOnError: true,
    onSuccess: (updatedQuote) => {
      if (updatedQuote) {
        sparkDebugLog('Receive quote completed', {
          quoteId: updatedQuote.id,
          accountId: updatedQuote.accountId,
          transactionId: updatedQuote.transactionId,
        });
        // Updating the quote cache triggers navigation to the transaction details page.
        // Completing the quote also completes the transaction and if navigation to transaction
        // page happens before transaction updated realtime notification is processed, the
        // transaction would be stale in the cache with the DRAFT state. We are invalidating the
        // transaction cache here so that it starts refetching the transaction as soon as possible
        // without relying on realtime notification which might be delayed when reconnecting due to
        // the app being in background.
        transactionsCache.invalidateTransaction(updatedQuote.transactionId);
        sparkReceiveQuoteCache.updateIfExists(updatedQuote);
        pendingQuotesCache.remove(updatedQuote);
      }
    },
    onError: (error, { quoteId }) => {
      console.error('Complete spark receive quote error', {
        cause: error,
        receiveQuoteId: quoteId,
      });
    },
  });

  const { mutate: expireReceiveQuote } = useMutation({
    mutationFn: async (quoteId: string) => {
      const quote = pendingQuotesCache.get(quoteId);
      if (!quote) {
        // Quote was updated in the meantime so it's not pending anymore.
        return;
      }
      await sparkReceiveQuoteService.expire(quote);
    },
    retry: 3,
    throwOnError: true,
    onError: (error, quoteId) => {
      console.error('Expire spark receive quote error', {
        cause: error,
        receiveQuoteId: quoteId,
      });
    },
  });

  const { mutate: failReceiveQuote } = useMutation({
    mutationFn: async ({
      quoteId,
      reason,
    }: { quoteId: string; reason: string }) => {
      const quote = pendingQuotesCache.get(quoteId);
      if (!quote) {
        // This can happen when the quote was updated in the meantime so it's not pending anymore.
        return;
      }
      await sparkReceiveQuoteService.fail(quote, reason);
    },
    retry: 3,
    throwOnError: true,
    onError: (error, { quoteId }) => {
      console.error('Fail spark receive quote error', {
        cause: error,
        receiveQuoteId: quoteId,
      });
    },
  });

  const { mutate: initiateMelt } = useMutation({
    mutationFn: async (quoteId: string) => {
      const quote = pendingQuotesCache.get(quoteId);
      if (quote?.type !== 'CASHU_TOKEN') {
        // Quote not defined can happen when the quote was updated in the meantime so it's not pending anymore.
        // Quote type not CASHU_TOKEN should never happen.
        return;
      }

      const cashuUnit = getCashuUnit(quote.amount.currency);
      const sourceMintUrl = quote.tokenReceiveData.sourceMintUrl;
      const sourceAccount = getCashuAccountByMintUrlAndCurrency(
        sourceMintUrl,
        quote.tokenReceiveData.tokenAmount.currency,
      );

      let sourceWallet: ExtendedCashuWallet;
      if (sourceAccount) {
        sourceWallet = sourceAccount.wallet;
      } else {
        const { wallet, isOnline } = await getInitializedCashuWallet({
          queryClient,
          mintUrl: sourceMintUrl,
          currency: quote.tokenReceiveData.tokenAmount.currency,
        });
        if (!isOnline) throw new NetworkError('Source mint is offline');
        sourceWallet = wallet;
      }

      await sourceWallet.meltProofsIdempotent(
        {
          quote: quote.tokenReceiveData.meltQuoteId,
          amount: quote.amount.toNumber(cashuUnit),
        },
        quote.tokenReceiveData.tokenProofs,
        undefined,
        // See claim-cashu-token-service.ts for rationale on random outputs.
        { type: 'random' },
      );
    },
    retry: (failureCount, error) => {
      if (error instanceof MintOperationError) {
        return false;
      }
      return failureCount < 3;
    },
    onError: (error, quoteId) => {
      if (error instanceof MintOperationError) {
        console.warn('Failed to initiate melt.', {
          cause: error,
          receiveQuoteId: quoteId,
        });
        failReceiveQuote(
          {
            quoteId,
            reason: error.message,
          },
          { scope: { id: `cashu-receive-quote-${quoteId}` } },
        );
      } else {
        console.error('Initiate melt error', {
          cause: error,
          receiveQuoteId: quoteId,
        });
      }
    },
  });

  const { mutate: markMeltInitiated } = useMutation({
    mutationFn: async (quoteId: string) => {
      const quote = pendingQuotesCache.get(quoteId);
      if (quote?.type !== 'CASHU_TOKEN') {
        // Quote not defined can happen when the quote was updated in the meantime so it's not pending anymore.
        // Quote type not CASHU_TOKEN should never happen.
        return;
      }

      await sparkReceiveQuoteService.markMeltInitiated(quote);
    },
    retry: 3,
    onError: (error, quoteId) => {
      console.error('Mark melt initiated error', {
        cause: error,
        receiveQuoteId: quoteId,
      });
    },
  });

  useOnSparkReceiveStateChange({
    onCompleted: (quoteId, paymentData) => {
      completeReceiveQuote(
        {
          quoteId,
          paymentPreimage: paymentData.paymentPreimage,
          sparkTransferId: paymentData.sparkTransferId,
          extras: paymentData.extras,
        },
        { scope: { id: `spark-receive-quote-${quoteId}` } },
      );
    },
    onExpired: (quoteId) => {
      expireReceiveQuote(quoteId, {
        scope: { id: `spark-receive-quote-${quoteId}` },
      });
    },
  });

  useOnMeltQuoteStateChange({
    quotes: pendingMeltQuotes,
    getWallet: (mintUrl, currency) => {
      const sourceAccount = getCashuAccountByMintUrlAndCurrency(
        mintUrl,
        currency,
      );
      return sourceAccount ? sourceAccount.wallet : getCashuWallet(mintUrl);
    },
    onUnpaid: (meltQuote) => {
      const receiveQuote = pendingQuotesCache.getByMeltQuoteId(meltQuote.quote);
      if (!receiveQuote) {
        return;
      }

      if (receiveQuote.tokenReceiveData.meltInitiated) {
        // If melt was initiated but the quote is again in the unpaid state, it means that the melt failed.
        failReceiveQuote(
          { quoteId: receiveQuote.id, reason: 'Cashu token melt failed.' },
          { scope: { id: `spark-receive-quote${receiveQuote.id}` } },
        );
      } else {
        initiateMelt(receiveQuote.id, {
          scope: { id: `spark-receive-quote${receiveQuote.id}` },
        });
      }
    },
    onPending: (meltQuote) => {
      const receiveQuote = pendingQuotesCache.getByMeltQuoteId(meltQuote.quote);
      if (!receiveQuote) {
        return;
      }

      markMeltInitiated(receiveQuote.id, {
        scope: { id: `spark-receive-quote${receiveQuote.id}` },
      });
    },
    onExpired: (meltQuote) => {
      const receiveQuote = pendingQuotesCache.getByMeltQuoteId(meltQuote.quote);
      if (!receiveQuote) {
        return;
      }

      expireReceiveQuote(receiveQuote.id, {
        scope: { id: `spark-receive-quote${receiveQuote.id}` },
      });
    },
  });
}
