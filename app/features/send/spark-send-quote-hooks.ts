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
  type SparkLightningQuote,
  useSparkSendQuoteService,
} from './spark-send-quote-service';

export class PendingSparkSendQuotesCache {
  public static Key = 'pending-spark-send-quotes';

  constructor(private readonly queryClient: QueryClient) {}

  get(quoteId: string) {
    return this.queryClient
      .getQueryData<SparkSendQuote[]>([PendingSparkSendQuotesCache.Key])
      ?.find((q) => q.id === quoteId);
  }

  add(quote: SparkSendQuote) {
    this.queryClient.setQueryData<SparkSendQuote[]>(
      [PendingSparkSendQuotesCache.Key],
      (curr) => [...(curr ?? []), quote],
    );
  }

  update(quote: SparkSendQuote) {
    this.queryClient.setQueryData<SparkSendQuote[]>(
      [PendingSparkSendQuotesCache.Key],
      (curr) =>
        curr?.map((q) =>
          q.id === quote.id && q.version < quote.version ? quote : q,
        ),
    );
  }

  remove(quote: SparkSendQuote) {
    this.queryClient.setQueryData<SparkSendQuote[]>(
      [PendingSparkSendQuotesCache.Key],
      (curr) => curr?.filter((q) => q.id !== quote.id),
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [PendingSparkSendQuotesCache.Key],
    });
  }
}

export function usePendingSparkSendQuotesCache() {
  const queryClient = useQueryClient();
  return useMemo(
    () => new PendingSparkSendQuotesCache(queryClient),
    [queryClient],
  );
}

/**
 * Hook that returns spark send quote change handlers.
 */
export function useSparkSendQuoteChangeHandlers() {
  const pendingQuotesCache = usePendingSparkSendQuotesCache();

  return [
    {
      event: 'SPARK_SEND_QUOTE_CREATED',
      handleEvent: async (payload: AgicashDbSparkSendQuote) => {
        const addedQuote = SparkSendQuoteRepository.toQuote(payload);
        pendingQuotesCache.add(addedQuote);
      },
    },
    {
      event: 'SPARK_SEND_QUOTE_UPDATED',
      handleEvent: async (payload: AgicashDbSparkSendQuote) => {
        const quote = SparkSendQuoteRepository.toQuote(payload);

        const isQuoteStillPending = quote.state === 'PENDING';
        if (isQuoteStillPending) {
          pendingQuotesCache.update(quote);
        } else {
          pendingQuotesCache.remove(quote);
        }
      },
    },
  ];
}

const usePendingSparkSendQuotes = () => {
  const sparkSendQuoteRepository = useSparkSendQuoteRepository();
  const userId = useUser((user) => user.id);
  const selectWithOnlineAccount = useSelectItemsWithOnlineAccount();

  const { data } = useQuery({
    queryKey: [PendingSparkSendQuotesCache.Key],
    queryFn: () => sparkSendQuoteRepository.getPending(userId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    throwOnError: true,
    select: selectWithOnlineAccount,
  });

  return data ?? [];
};

type OnSparkSendStateChangeCallbacks = {
  /**
   * Called when a quote's payment is completed.
   */
  onCompleted: (
    quote: SparkSendQuote,
    paymentData: {
      paymentPreimage: string;
      sparkTransferId: string;
      fee: Money;
    },
  ) => void;
  /**
   * Called when a quote's payment fails.
   */
  onFailed: (quote: SparkSendQuote) => void;
};

/**
 * Hook that polls pending spark send quotes and fires callbacks on state changes.
 * Polls every second to check for payment status.
 */
export function useOnSparkSendStateChange({
  onCompleted,
  onFailed,
}: OnSparkSendStateChangeCallbacks) {
  const pendingQuotes = usePendingSparkSendQuotes();
  const getSparkAccount = useGetSparkAccount();

  const onCompletedRef = useLatest(onCompleted);
  const onFailedRef = useLatest(onFailed);

  const checkQuoteStatus = async (quote: SparkSendQuote) => {
    try {
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
        if (!sendRequest.paymentPreimage || !sendRequest.transfer?.sparkId) {
          throw new Error(
            'Completed spark send quote is missing required fields',
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
        quoteId: quote.id,
      });
    }
  };

  const checkQuoteStatusRef = useLatest(checkQuoteStatus);

  useEffect(() => {
    if (pendingQuotes.length === 0) return;

    const intervals: NodeJS.Timeout[] = [];

    for (const quote of pendingQuotes) {
      const interval = setInterval(() => {
        checkQuoteStatusRef.current(quote);
      }, 1000);
      intervals.push(interval);
    }

    return () => {
      intervals.forEach((interval) => clearInterval(interval));
    };
  }, [pendingQuotes]);
}

/**
 * Hook that processes pending spark send quotes.
 * Polls the Spark API to check for payment status and updates quotes accordingly.
 */
export function useProcessSparkSendQuoteTasks() {
  const sparkSendQuoteService = useSparkSendQuoteService();
  const pendingQuotesCache = usePendingSparkSendQuotesCache();
  const queryClient = useQueryClient();

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
      const cachedQuote = pendingQuotesCache.get(quote.id);
      if (!cachedQuote) {
        // Quote was updated in the meantime so it's not pending anymore.
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
        pendingQuotesCache.remove(updatedQuote);
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

  const { mutate: failSendQuote } = useMutation({
    mutationFn: async (quote: SparkSendQuote) => {
      const cachedQuote = pendingQuotesCache.get(quote.id);
      if (!cachedQuote) {
        // Quote was updated in the meantime so it's not pending anymore.
        return;
      }
      await sparkSendQuoteService.fail(quote, 'Lightning payment failed');
    },
    retry: 3,
    throwOnError: true,
    onSuccess: (_, quote) => {
      // Invalidate spark balance since the send failed and funds should be returned
      queryClient.invalidateQueries({
        queryKey: sparkBalanceQueryKey(quote.accountId),
      });
    },
    onError: (error, quote) => {
      console.error('Fail spark send quote error', {
        cause: error,
        sendQuoteId: quote.id,
      });
    },
  });

  useOnSparkSendStateChange({
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
      failSendQuote(quote, {
        scope: { id: `spark-send-quote-${quote.id}` },
      });
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

type InitiateSparkSendQuoteParams = {
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
 * Returns a mutation for initiating a Spark Lightning send request.
 * The quote is stored in the database and will be tracked by the background task processor.
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
      id: 'initiate-spark-send-quote',
    },
    mutationFn: ({ account, quote }: InitiateSparkSendQuoteParams) => {
      return sparkSendQuoteService.initiateSend({
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
