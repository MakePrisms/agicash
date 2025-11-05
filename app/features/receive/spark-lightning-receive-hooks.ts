import {
  type QueryClient,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useGetExchangeRate } from '~/hooks/use-exchange-rate';
import type { Money } from '~/lib/money';
import { useLatest } from '~/lib/use-latest';
import {
  type SparkLightningReceive,
  useSparkLightningReceiveService,
} from './spark-lightning-receive-service';

class SparkLightningReceiveCache {
  public static Key = 'spark-lightning-receive';

  constructor(private readonly queryClient: QueryClient) {}

  add(request: SparkLightningReceive) {
    this.queryClient.setQueryData<SparkLightningReceive>(
      [SparkLightningReceiveCache.Key, request.id],
      request,
    );
  }
}

const useSparkLightningReceiveCache = () => {
  const queryClient = useQueryClient();
  return useMemo(
    () => new SparkLightningReceiveCache(queryClient),
    [queryClient],
  );
};

type CreateSparkLightningReceiveParams = {
  /**
   * The amount to receive. This will be converted to sats when creating the invoice.
   */
  amount: Money;
  /**
   * The Spark public key of the receiver. Used to create invoices on behalf of another user.
   * If not provided, the invoice will be created for the user that owns the Spark wallet.
   */
  receiverIdentityPubkey?: string;
};

/** Returns a mutation for creating a Spark Lightning receive requests which will be added to the cache. */
export function useCreateSparkLightningReceive({
  onSuccess,
  onError,
}: {
  onSuccess?: (request: SparkLightningReceive) => void;
  onError?: (error: Error) => void;
}) {
  const sparkLightningReceiveService = useSparkLightningReceiveService();
  const getExchangeRate = useGetExchangeRate();
  const cache = useSparkLightningReceiveCache();

  return useMutation({
    mutationFn: async ({
      amount,
      receiverIdentityPubkey,
    }: CreateSparkLightningReceiveParams) => {
      return sparkLightningReceiveService.create({
        amount,
        receiverIdentityPubkey,
        getExchangeRate,
      });
    },
    onSuccess: (request) => {
      cache.add(request);
      onSuccess?.(request);
    },
    onError: (error) => {
      onError?.(error);
    },
  });
}

type TrackSparkLightningReceiveProps = {
  /** The ID of the Spark Lightning Receive Request */
  requestId: string;
  onCompleted?: (request: SparkLightningReceive) => void;
  onFailed?: (request: SparkLightningReceive) => void;
  onExpired?: (request: SparkLightningReceive) => void;
};

/**
 * A hook that polls pending Spark Lightning receive requests every second until the request is completed, failed, or expired.
 * @throws Error if the request is not found
 * @returns The request
 */
export function useTrackSparkLightningReceive({
  requestId,
  onCompleted,
  onFailed,
  onExpired,
}: TrackSparkLightningReceiveProps) {
  const sparkLightningReceiveService = useSparkLightningReceiveService();
  const onCompletedRef = useLatest(onCompleted);
  const onFailedRef = useLatest(onFailed);
  const onExpiredRef = useLatest(onExpired);

  const { data: request } = useSuspenseQuery({
    queryKey: [SparkLightningReceiveCache.Key, requestId],
    queryFn: async (): Promise<SparkLightningReceive> =>
      sparkLightningReceiveService.get(requestId),
    refetchInterval: (query) => {
      if (query.state.data?.state === 'PENDING') {
        return 1000;
      }
      return false;
    },
  });

  useEffect(() => {
    if (request.state === 'COMPLETED') {
      // TODO: see how to refresh the balance immediatly.
      onCompletedRef.current?.(request);
    } else if (request.state === 'FAILED') {
      onFailedRef.current?.(request);
    } else if (request.state === 'EXPIRED') {
      onExpiredRef.current?.(request);
    }
  }, [request]);

  return { request };
}
