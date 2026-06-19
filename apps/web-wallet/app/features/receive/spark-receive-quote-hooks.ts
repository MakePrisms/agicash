import type { Money } from '@agicash/money';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { getSdk } from '~/lib/sdk';
import { useLatest } from '~/lib/use-latest';
import type { SparkAccount } from '../accounts/account';
import type { TransactionPurpose } from '../transactions/transaction-enums';
import type { SparkReceiveQuote } from './spark-receive-quote';

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

type UseTrackSparkReceiveQuoteProps = {
  quoteId?: string;
  onPaid?: (quote: SparkReceiveQuote) => void;
  onExpired?: (quote: SparkReceiveQuote) => void;
};

type UseTrackSparkReceiveQuoteResponse =
  | {
      status: 'LOADING';
      quote?: undefined;
    }
  | {
      status: SparkReceiveQuote['state'];
      quote: SparkReceiveQuote;
    };

export function useTrackSparkReceiveQuote({
  quoteId,
  onPaid,
  onExpired,
}: UseTrackSparkReceiveQuoteProps): UseTrackSparkReceiveQuoteResponse {
  const enabled = !!quoteId;
  const onPaidRef = useLatest(onPaid);
  const onExpiredRef = useLatest(onExpired);

  const { data } = useQuery({
    queryKey: [SparkReceiveQuoteCache.Key, quoteId],
    // biome-ignore lint/style/noNonNullAssertion: quoteId is guaranteed by enabled
    queryFn: () => getSdk().spark.receive.get(quoteId!),
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

export function useWireSparkReceiveQuoteEvents() {
  const pendingQuotesCache = usePendingSparkReceiveQuotesCache();
  const sparkReceiveQuoteCache = useSparkReceiveQuoteCache();

  useEffect(() => {
    const sdk = getSdk();
    const unsubscribers = [
      sdk.on('spark-receive-quote:created', ({ entity }) => {
        pendingQuotesCache.add(entity);
      }),
      sdk.on('spark-receive-quote:updated', ({ entity }) => {
        sparkReceiveQuoteCache.updateIfExists(entity);

        const isQuoteStillPending = entity.state === 'UNPAID';
        if (isQuoteStillPending) {
          pendingQuotesCache.update(entity);
        } else {
          pendingQuotesCache.remove(entity);
        }
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [pendingQuotesCache, sparkReceiveQuoteCache]);
}

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
   * Description to include in the Lightning invoice memo.
   */
  description?: string;
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
 * The quote is stored in the database and will be tracked by the SDK background processor.
 */
export function useCreateSparkReceiveQuote() {
  const sparkReceiveQuoteCache = useSparkReceiveQuoteCache();

  return useMutation({
    scope: {
      id: 'create-spark-receive-quote',
    },
    mutationFn: async ({
      account,
      amount,
      description,
      purpose,
      transferId,
    }: CreateProps) => {
      const sdk = getSdk();
      const quote = await sdk.spark.receive.createLightningQuote({
        account,
        amount,
        description,
      });

      // Create-only: the SDK leader tracks payment asynchronously.
      return sdk.spark.receive.execute({
        account,
        quote,
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
