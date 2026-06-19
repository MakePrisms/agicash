import type { Money } from '@agicash/money';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useSdk } from '~/features/shared/use-sdk';
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
  const sdk = useSdk();

  const { data } = useQuery({
    queryKey: [SparkReceiveQuoteCache.Key, quoteId],
    // biome-ignore lint/style/noNonNullAssertion: quoteId is guaranteed by enabled
    queryFn: async () => (await sdk).spark.receive.get(quoteId!),
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
 * Returns a mutation for creating a Spark receive quote. The quote is persisted
 * and the SDK background orchestrator drives it to terminal.
 */
export function useCreateSparkReceiveQuote() {
  const sdkPromise = useSdk();
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
    }: CreateProps) => {
      const sdk = await sdkPromise;
      return sdk.spark.receive.createLightningQuote({
        account,
        amount,
        description,
        purpose: purpose === 'BUY_CASHAPP' ? 'BUY_CASHAPP' : 'PAYMENT',
      });
    },
    onSuccess: (data) => {
      sparkReceiveQuoteCache.add(data);
    },
    retry: 1,
  });
}
