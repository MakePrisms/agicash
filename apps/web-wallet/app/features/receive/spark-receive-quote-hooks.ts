import type { Money } from '@agicash/money';
import type {
  SparkAccount,
  SparkReceiveQuote,
  TransactionPurpose,
} from '@agicash/wallet-sdk';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { sdk } from '~/features/shared/sdk.client';
import { useLatest } from '~/lib/use-latest';
import { useTransactionsCache } from '../transactions/transaction-hooks';
import type { WalletChangeHandlers } from '../wallet/use-track-wallet-changes';

class SparkReceiveQuoteCache {
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
  const transactionsCache = useTransactionsCache();

  const { data } = useQuery({
    queryKey: [SparkReceiveQuoteCache.Key, quoteId],
    // biome-ignore lint/style/noNonNullAssertion: quoteId is guaranteed by enabled
    queryFn: () => sdk.receive.spark.getQuote(quoteId!),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    enabled,
  });

  useEffect(() => {
    if (!data) return;

    if (data.state === 'PAID') {
      transactionsCache.invalidateTransaction(data.transactionId);
      onPaidRef.current?.(data);
    } else if (data.state === 'EXPIRED') {
      onExpiredRef.current?.(data);
    }
  }, [data, transactionsCache]);

  if (!data) {
    return { status: 'LOADING' };
  }

  return {
    status: data.state,
    quote: data,
  };
}

/**
 * Hook that returns spark receive quote change handlers.
 */
export function useSparkReceiveQuoteChangeHandlers(): WalletChangeHandlers<'spark-receive-quote.updated'> {
  const sparkReceiveQuoteCache = useSparkReceiveQuoteCache();

  return {
    'spark-receive-quote.updated': ({ quote }) => {
      sparkReceiveQuoteCache.updateIfExists(quote);
    },
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
 * Returns a mutation for creating a Spark receive quote.
 * The quote is stored in the database and will be tracked by the background task processor.
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
      const lightningQuote = await sdk.receive.spark.getLightningQuote({
        account,
        amount,
        description,
      });
      return sdk.receive.spark.createQuote({
        account,
        lightningQuote,
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
