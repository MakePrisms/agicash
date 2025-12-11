import { LightningSendRequestStatus } from '@buildonspark/spark-sdk/types';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import type { Money } from '~/lib/money';
import { moneyFromSparkAmount } from '~/lib/spark';
import { useLatest } from '~/lib/use-latest';
import type { SparkAccount } from '../accounts/account';
import {
  useGetSparkAccount,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import type { AgicashDbSparkSendQuote } from '../agicash-db/database';
import { sparkBalanceQueryKey } from '../shared/spark';
import { useUser } from '../user/user-hooks';
import type { SparkSendQuote } from './spark-send-quote';
import {
  SparkSendQuoteRepository,
  useSparkSendQuoteRepository,
} from './spark-send-quote-repository';
import {
  InvoiceAlreadyPaidError,
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

  return [
    {
      event: 'SPARK_SEND_QUOTE_CREATED',
      handleEvent: async (payload: AgicashDbSparkSendQuote) => {
        const addedQuote = SparkSendQuoteRepository.toQuote(payload);
        unresolvedQuotesCache.add(addedQuote);
      },
    },
    {
      event: 'SPARK_SEND_QUOTE_UPDATED',
      handleEvent: async (payload: AgicashDbSparkSendQuote) => {
        const quote = SparkSendQuoteRepository.toQuote(payload);

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
  onUnpaid: (quote: SparkSendQuote) => void;
  onCompleted: (
    quote: SparkSendQuote,
    paymentData: {
      paymentPreimage: string;
      sparkTransferId: string;
      fee: Money;
    },
  ) => void;
  onFailed: (quote: SparkSendQuote) => void;
};

/**
 * Hook that polls unresolved spark send quotes and fires callbacks on state changes.
 * For UNPAID quotes, calls onUnpaid to trigger payment initiation.
 * For PENDING quotes, polls every second to check for payment status.
 */
export function useOnSparkSendStateChange({
  onUnpaid,
  onCompleted,
  onFailed,
}: OnSparkSendStateChangeCallbacks) {
  const unresolvedQuotes = useUnresolvedSparkSendQuotes();
  const unresolvedQuotesCache = useUnresolvedSparkSendQuotesCache();
  const getSparkAccount = useGetSparkAccount();

  const onUnpaidRef = useLatest(onUnpaid);
  const onCompletedRef = useLatest(onCompleted);
  const onFailedRef = useLatest(onFailed);

  const checkQuoteStatus = async (quoteId: string) => {
    try {
      const quote = unresolvedQuotesCache.get(quoteId);
      if (!quote) {
        return;
      }

      if (quote.state === 'UNPAID') {
        onUnpaidRef.current(quote);
        return;
      }

      if (quote.state !== 'PENDING') {
        return;
      }

      const account = getSparkAccount(quote.accountId);
      if (!account.wallet) {
        return;
      }

      const sendRequest = await account.wallet.getLightningSendRequest(
        quote.sparkId,
      );

      if (!sendRequest) {
        return;
      }

      if (
        sendRequest.status === LightningSendRequestStatus.TRANSFER_COMPLETED
      ) {
        if (!sendRequest.paymentPreimage) {
          throw new Error(
            'Payment preimage is required when send request has TRANSFER_COMPLETED status.',
          );
        }
        if (!sendRequest.transfer?.sparkId) {
          throw new Error(
            'Spark transfer ID is required when send request has TRANSFER_COMPLETED status.',
          );
        }
        onCompletedRef.current(quote, {
          sparkTransferId: sendRequest.transfer.sparkId,
          paymentPreimage: sendRequest.paymentPreimage,
          fee: moneyFromSparkAmount(sendRequest.fee),
        });
        return;
      }

      if (
        sendRequest.status ===
        LightningSendRequestStatus.LIGHTNING_PAYMENT_FAILED
      ) {
        onFailedRef.current(quote);
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
    if (unresolvedQuotes.length === 0) return;

    const intervals: NodeJS.Timeout[] = [];

    for (const quote of unresolvedQuotes) {
      if (quote.state === 'UNPAID') {
        checkQuoteStatusRef.current(quote.id);
      }

      const interval = setInterval(() => {
        checkQuoteStatusRef.current(quote.id);
      }, 1000);
      intervals.push(interval);
    }

    return () => {
      intervals.forEach((interval) => clearInterval(interval));
    };
  }, [unresolvedQuotes]);
}

/**
 * Hook that processes unresolved spark send quotes.
 * - For UNPAID quotes: Initiates the lightning payment
 * - For PENDING quotes: Polls the Spark API to check for payment status and updates quotes accordingly.
 */
export function useProcessSparkSendQuoteTasks() {
  const sparkSendQuoteService = useSparkSendQuoteService();
  const unresolvedQuotesCache = useUnresolvedSparkSendQuotesCache();
  const getSparkAccount = useGetSparkAccount();
  const queryClient = useQueryClient();

  const { mutate: failSendQuote } = useMutation({
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

      await sparkSendQuoteService.fail(quote, reason);
      return quote;
    },
    retry: 3,
    throwOnError: true,
    onError: (error, variables) => {
      console.error('Failed to mark spark send quote as failed', {
        cause: error,
        sendQuoteId: variables.quoteId,
      });
    },
  });

  const { mutate: initiateSend } = useMutation({
    mutationFn: async (quote: SparkSendQuote) => {
      const cachedQuote = unresolvedQuotesCache.get(quote.id);
      if (!cachedQuote || cachedQuote.state !== 'UNPAID') {
        // Quote was updated in the meantime, skip initiation.
        return null;
      }

      const account = getSparkAccount(quote.accountId);
      return sparkSendQuoteService
        .initiateSend({
          account,
          sendQuote: quote,
        })
        .catch((error) => {
          if (error instanceof InvoiceAlreadyPaidError) {
            failSendQuote({
              quoteId: quote.id,
              reason: error.message,
            });
            return null;
          }
          throw error;
        });
    },
    retry: 1,
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

  const { mutate: completeSendQuote } = useMutation({
    mutationFn: async ({
      quote,
      paymentPreimage,
      sparkTransferId,
      fee,
    }: {
      quote: SparkSendQuote;
      paymentPreimage: string;
      sparkTransferId: string;
      fee: Money;
    }) => {
      const cachedQuote = unresolvedQuotesCache.get(quote.id);
      if (!cachedQuote) {
        // Quote was updated in the meantime so it's not unresolved anymore.
        return;
      }
      return sparkSendQuoteService.complete(
        quote,
        paymentPreimage,
        sparkTransferId,
        fee,
      );
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
    onUnpaid: (quote) => {
      initiateSend(quote, {
        scope: { id: `spark-send-quote-initiate-${quote.id}` },
      });
    },
    onCompleted: (quote, paymentData) => {
      completeSendQuote(
        {
          quote,
          paymentPreimage: paymentData.paymentPreimage,
          sparkTransferId: paymentData.sparkTransferId,
          fee: paymentData.fee,
        },
        { scope: { id: `spark-send-quote-${quote.id}` } },
      );
    },
    onFailed: (quote) => {
      failSendQuote(
        { quoteId: quote.id, reason: 'Lightning payment failed' },
        { scope: { id: `spark-send-quote-${quote.id}` } },
      );
    },
  });
}

type GetSparkSendQuoteParams = {
  /**
   * The ID of the Spark account to get a quote for.
   */
  accountId: string;
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
 * Returns a mutation for estimating the fee for a Lightning send.
 */
export function useGetSparkSendQuote(options?: {
  onSuccess?: (quote: SparkLightningQuote) => void;
  onError?: (error: Error) => void;
}) {
  const sparkSendQuoteService = useSparkSendQuoteService();
  const getSparkAccount = useGetSparkAccount();

  return useMutation({
    mutationFn: async ({
      accountId,
      paymentRequest,
      amount,
    }: GetSparkSendQuoteParams) => {
      const account = getSparkAccount(accountId);
      return sparkSendQuoteService.getLightningSendQuote({
        account,
        paymentRequest,
        amount: amount as Money<'BTC'>,
      });
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
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
    retry: 1,
  });
}
