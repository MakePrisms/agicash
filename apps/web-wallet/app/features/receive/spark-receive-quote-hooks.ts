import type { Money } from '@agicash/money';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getSdk } from '~/lib/sdk';
import { useLatest } from '~/lib/use-latest';
import type { SparkAccount } from '../accounts/account';
import type { TransactionPurpose } from '../transactions/transaction-enums';
import type { SparkReceiveQuote } from './spark-receive-quote';

/**
 * Query key for the "active" spark receive quote tracked by id. Variant B has no
 * row events and terminal quotes are evicted from the SDK's pending store, so
 * terminal liveness is driven by the SDK's core lifecycle events (see
 * {@link useTrackSparkReceiveQuote}).
 */
const SparkReceiveQuoteQueryKey = 'spark-receive-quote';

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

/**
 * Tracks a single spark receive quote by id.
 *
 * Variant B has no row events for receive quotes and terminal quotes are evicted
 * from the SDK's pending store, so terminal liveness is driven by the SDK's core
 * lifecycle events: a spark receive quote's terminal transition emits
 * `receive:completed` (PAID — terminal for spark) / `receive:expired` (EXPIRED)
 * with `payload.protocol === 'spark'` and `payload.quoteId` set to the quote's id
 * (see `internal/realtime/lifecycle-events.ts`). On a matching event we refetch
 * the keyed query and the freshly-loaded quote drives the `onPaid`/`onExpired`
 * callbacks. `refetchOnWindowFocus/Reconnect: 'always'` is kept as a safety net.
 */
export function useTrackSparkReceiveQuote({
  quoteId,
  onPaid,
  onExpired,
}: UseTrackSparkReceiveQuoteProps): UseTrackSparkReceiveQuoteResponse {
  const enabled = !!quoteId;
  const onPaidRef = useLatest(onPaid);
  const onExpiredRef = useLatest(onExpired);

  const { data, refetch } = useQuery({
    queryKey: [SparkReceiveQuoteQueryKey, quoteId],
    // biome-ignore lint/style/noNonNullAssertion: quoteId is guaranteed by enabled
    queryFn: () => getSdk().spark.receive.get(quoteId!),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    enabled,
  });

  useEffect(() => {
    if (!enabled) return;

    const sdk = getSdk();
    const refetchOnMatch = (payload: {
      protocol: 'cashu' | 'spark';
      quoteId: string;
    }) => {
      if (payload.protocol === 'spark' && payload.quoteId === quoteId) {
        void refetch();
      }
    };

    const offs = [
      sdk.on('receive:completed', refetchOnMatch),
      sdk.on('receive:expired', refetchOnMatch),
    ];

    return () => {
      for (const off of offs) {
        off();
      }
    };
  }, [enabled, quoteId, refetch]);

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
 * Returns a mutation for creating a Spark receive quote.
 * The quote is stored in the database and will be tracked by the SDK background processor.
 */
export function useCreateSparkReceiveQuote() {
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
    retry: 1,
  });
}
