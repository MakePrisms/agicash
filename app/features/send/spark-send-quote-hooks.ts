import { LightningSendRequestStatus } from '@buildonspark/spark-sdk/types';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import type { Money } from '~/lib/money';
import { measureOperation } from '~/lib/performance';
import { useLatest } from '~/lib/use-latest';
import type { SparkAccount } from '../accounts/account';
import {
  useGetSparkAccount,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import type { AgicashDbSparkSendQuote } from '../agicash-db/database';
import { DomainError } from '../shared/error';
import { sparkBalanceQueryKey } from '../shared/spark';
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
 * Hook that fires callbacks on initial load and when the state of a quote changes.
 *
 * The quote state is tracked with polling. Callbacks are only triggered when the
 * state changes from the previous invocation.
 */
export function useOnSparkSendStateChange({
  sendQuotes,
  onUnpaid,
  onCompleted,
  onFailed,
}: OnSparkSendStateChangeCallbacks) {
  const unresolvedQuotesCache = useUnresolvedSparkSendQuotesCache();
  const getSparkAccount = useGetSparkAccount();

  const onUnpaidRef = useLatest(onUnpaid);
  const onCompletedRef = useLatest(onCompleted);
  const onFailedRef = useLatest(onFailed);

  // Track the last triggered state for each quote to avoid duplicate callbacks
  const lastTriggeredStateRef = useRef<Map<string, SparkSendQuote['state']>>(
    new Map(),
  );

  const checkQuoteStatus = async (quoteId: string) => {
    try {
      const quote = unresolvedQuotesCache.get(quoteId);
      if (!quote) {
        return;
      }

      if (
        quote.state === 'UNPAID' &&
        lastTriggeredStateRef.current.get(quoteId) !== 'UNPAID'
      ) {
        lastTriggeredStateRef.current.set(quoteId, 'UNPAID');
        onUnpaidRef.current(quote);
        return;
      }

      if (quote.state !== 'PENDING') {
        return;
      }

      const account = getSparkAccount(quote.accountId);

      const sendRequest = await measureOperation(
        'SparkWallet.getLightningSendRequest',
        () => account.wallet.getLightningSendRequest(quote.sparkId),
        { sendRequestId: quote.sparkId },
      );

      if (!sendRequest) {
        return;
      }

      if (
        sendRequest.status === LightningSendRequestStatus.TRANSFER_COMPLETED &&
        lastTriggeredStateRef.current.get(quoteId) !== 'COMPLETED'
      ) {
        if (!sendRequest.paymentPreimage) {
          throw new Error(
            'Payment preimage is required when send request has TRANSFER_COMPLETED status.',
          );
        }

        lastTriggeredStateRef.current.set(quoteId, 'COMPLETED');

        onCompletedRef.current(quote, {
          paymentPreimage: sendRequest.paymentPreimage,
        });
        return;
      }

      if (
        sendRequest.status === LightningSendRequestStatus.USER_SWAP_RETURNED &&
        lastTriggeredStateRef.current.get(quoteId) !== 'FAILED'
      ) {
        lastTriggeredStateRef.current.set(quoteId, 'FAILED');

        const now = new Date();
        const message =
          quote.expiresAt && new Date(quote.expiresAt) < now
            ? 'Lightning invoice expired.'
            : 'Lightning payment failed.';

        onFailedRef.current(quote, message);
      }
    } catch (error) {
      console.error('Error checking spark send quote status', {
        cause: error,
        quoteId,
      });
    }
  };

  const checkQuoteStatusRef = useLatest(checkQuoteStatus);

  useEffect(() => {
    const quoteIds = sendQuotes.map((q) => q.id);
    const quoteIdSet = new Set(quoteIds);

    // Clean up tracked states for quotes that are no longer in the list
    for (const trackedQuoteId of lastTriggeredStateRef.current.keys()) {
      if (!quoteIdSet.has(trackedQuoteId)) {
        lastTriggeredStateRef.current.delete(trackedQuoteId);
      }
    }

    if (quoteIds.length === 0) return;

    const checkStatuses = () => {
      for (const quoteId of quoteIds) {
        checkQuoteStatusRef.current(quoteId);
      }
    };

    checkStatuses();
    const interval = setInterval(checkStatuses, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [sendQuotes]);
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
 * - For PENDING quotes: Polls the Spark API to check for payment status and updates quotes accordingly.
 */
export function useProcessSparkSendQuoteTasks() {
  const sparkSendQuoteService = useSparkSendQuoteService();
  const unresolvedSendQuotes = useUnresolvedSparkSendQuotes();
  const unresolvedQuotesCache = useUnresolvedSparkSendQuotesCache();
  const getSparkAccount = useGetSparkAccount();
  const queryClient = useQueryClient();

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
          unresolvedQuotesCache.remove(updatedQuote);
          // Invalidate spark balance since we sent funds
          queryClient.invalidateQueries({
            queryKey: sparkBalanceQueryKey(updatedQuote.accountId),
          });
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
