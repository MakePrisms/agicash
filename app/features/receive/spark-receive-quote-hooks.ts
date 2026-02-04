import { LightningReceiveRequestStatus } from '@buildonspark/spark-sdk/types';
import { MintOperationError } from '@cashu/cashu-ts';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import {
  getCashuUnit,
  getCashuWallet,
  sumProofs,
  useOnMeltQuoteStateChange,
} from '~/lib/cashu';
import type { Money } from '~/lib/money';
import { measureOperation } from '~/lib/performance';
import { useLatest } from '~/lib/use-latest';
import type { SparkAccount } from '../accounts/account';
import {
  useGetSparkAccount,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import type { AgicashDbSparkReceiveQuote } from '../agicash-db/database';
import { sparkBalanceQueryKey } from '../shared/spark';
import { useUser } from '../user/user-hooks';
import type { SparkReceiveQuote } from './spark-receive-quote';
import { getLightningQuote } from './spark-receive-quote-core';
import { useSparkReceiveQuoteRepository } from './spark-receive-quote-repository';
import { useSparkReceiveQuoteService } from './spark-receive-quote-service';

class SparkReceiveQuoteCache {
  // Query that tracks the "active" spark receive quote. Active one is the one that user created in current browser session.
  // We want to track active quote even after it is expired and completed which is why we can't use pending quotes query.
  // Pending quotes query is used for active pending quote plus "background" pending quotes. "Background" quotes are quotes
  // that were created in previous browser sessions.
  public static Key = 'spark-receive-quote';

  constructor(private readonly queryClient: QueryClient) {}

  get(quoteId: string) {
    return this.queryClient.getQueryData<SparkReceiveQuote>([
      SparkReceiveQuoteCache.Key,
      quoteId,
    ]);
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

function useSparkReceiveQuoteCache() {
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
  const cache = useSparkReceiveQuoteCache();

  const { data } = useQuery({
    queryKey: [SparkReceiveQuoteCache.Key, quoteId],
    queryFn: () => cache.get(quoteId ?? ''),
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
   * The amount to receive.
   */
  amount: Money;
  /**
   * The Spark public key of the receiver used to create invoices on behalf of another user.
   * If not provided, the invoice will be created for the user that owns the Spark wallet.
   */
  receiverIdentityPubkey?: string;
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
      receiverIdentityPubkey,
    }: CreateProps) => {
      const lightningQuote = await getLightningQuote({
        wallet: account.wallet,
        amount,
        receiverIdentityPubkey,
      });

      return sparkReceiveQuoteService.createReceiveQuote({
        userId,
        account,
        lightningQuote,
        receiveType: 'LIGHTNING',
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
   */
  onCompleted: (
    quoteId: string,
    paymentData: {
      paymentPreimage: string;
      sparkTransferId: string;
    },
  ) => void;
  /**
   * Called when a quote expires without being paid.
   */
  onExpired: (quoteId: string) => void;
};

const ONE_SECOND = 1000;
const FIVE_SECONDS = 5 * ONE_SECOND;
const THIRTY_SECONDS = 30 * ONE_SECOND;
const ONE_MINUTE = 60 * ONE_SECOND;
const FIVE_MINUTES = 5 * ONE_MINUTE;
const TEN_MINUTES = 10 * ONE_MINUTE;
const ONE_HOUR = 60 * ONE_MINUTE;

/**
 * Returns the polling interval in milliseconds based on the quote's age.
 * - 1 second if created within last 5 minutes
 * - 5 seconds if created within last 10 minutes
 * - 30 seconds if created within last hour
 * - 1 minute if created more than 1 hour ago
 */
function getPollingInterval(createdAt: string): number {
  const ageMs = Date.now() - new Date(createdAt).getTime();

  if (ageMs < FIVE_MINUTES) {
    return ONE_SECOND;
  }
  if (ageMs < TEN_MINUTES) {
    return FIVE_SECONDS;
  }
  if (ageMs < ONE_HOUR) {
    return THIRTY_SECONDS;
  }
  return ONE_MINUTE;
}

/**
 * Hook that polls pending spark receive quotes and fires callbacks on state changes.
 * Polling interval is based on the quote's age:
 * - 1 second if created within last 5 minutes
 * - 5 seconds if created within last 10 minutes
 * - 30 seconds if created within last hour
 * - 1 minute if created more than 1 hour ago
 */
export function useOnSparkReceiveStateChange({
  onCompleted,
  onExpired,
}: OnSparkReceiveStateChangeCallbacks) {
  const pendingQuotes = usePendingSparkReceiveQuotes();
  const getSparkAccount = useGetSparkAccount();

  const onCompletedRef = useLatest(onCompleted);
  const onExpiredRef = useLatest(onExpired);

  const checkQuoteStatus = async (quote: SparkReceiveQuote) => {
    try {
      const account = getSparkAccount(quote.accountId);
      const receiveRequest = await measureOperation(
        'SparkWallet.getLightningReceiveRequest',
        () => account.wallet.getLightningReceiveRequest(quote.sparkId),
        { receiveRequestId: quote.sparkId },
      );

      if (!receiveRequest) {
        return;
      }

      if (
        receiveRequest.status ===
        LightningReceiveRequestStatus.TRANSFER_COMPLETED
      ) {
        if (!receiveRequest.paymentPreimage) {
          throw new Error(
            'Payment preimage is required when receive request has TRANSFER_COMPLETED status.',
          );
        }
        if (!receiveRequest.transfer?.sparkId) {
          throw new Error(
            'Spark transfer ID is required when receive request has TRANSFER_COMPLETED status.',
          );
        }
        onCompletedRef.current(quote.id, {
          sparkTransferId: receiveRequest.transfer.sparkId,
          paymentPreimage: receiveRequest.paymentPreimage,
        });
        return;
      }

      const expiresAt = new Date(receiveRequest.invoice.expiresAt);
      const now = new Date();

      if (now > expiresAt) {
        onExpiredRef.current(quote.id);
      }
    } catch (error) {
      console.error('Error checking spark receive quote status', {
        cause: error,
        quoteId: quote.id,
      });
    }
  };

  const checkQuoteStatusRef = useLatest(checkQuoteStatus);

  useEffect(() => {
    if (pendingQuotes.length === 0) return;

    const timeouts: NodeJS.Timeout[] = [];

    const poll = (quote: SparkReceiveQuote) => {
      checkQuoteStatusRef.current(quote);
      const interval = getPollingInterval(quote.createdAt);
      const timeout = setTimeout(() => poll(quote), interval);
      timeouts.push(timeout);
    };

    for (const quote of pendingQuotes) {
      poll(quote);
    }

    return () => {
      timeouts.forEach((timeout) => clearTimeout(timeout));
    };
  }, [pendingQuotes]);
}

/**
 * Hook that processes pending spark receive quotes.
 * Polls the Spark API to check for payment status and updates quotes accordingly.
 */
export function useProcessSparkReceiveQuoteTasks() {
  const sparkReceiveQuoteService = useSparkReceiveQuoteService();
  const pendingMeltQuotes = usePendingMeltQuotes();
  const pendingQuotesCache = usePendingSparkReceiveQuotesCache();
  const queryClient = useQueryClient();

  const { mutate: completeReceiveQuote } = useMutation({
    mutationFn: async ({
      quoteId,
      paymentPreimage,
      sparkTransferId,
    }: {
      quoteId: string;
      paymentPreimage: string;
      sparkTransferId: string;
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
      );
    },
    retry: 3,
    throwOnError: true,
    onSuccess: (updatedQuote) => {
      if (updatedQuote) {
        pendingQuotesCache.remove(updatedQuote);
        // Invalidate spark balance since we received funds
        queryClient.invalidateQueries({
          queryKey: sparkBalanceQueryKey(updatedQuote.accountId),
        });
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
      const sourceWallet = getCashuWallet(
        quote.tokenReceiveData.sourceMintUrl,
        {
          unit: cashuUnit,
        },
      );

      await sourceWallet.meltProofsIdempotent(
        {
          quote: quote.tokenReceiveData.meltQuoteId,
          amount: quote.amount.toNumber(cashuUnit),
        },
        quote.tokenReceiveData.tokenProofs,
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
