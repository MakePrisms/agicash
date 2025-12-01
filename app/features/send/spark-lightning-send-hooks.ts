import {
  type QueryClient,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import type { Money } from '~/lib/money';
import { useLatest } from '~/lib/use-latest';
import {
  type SparkLightningSend,
  type SparkLightningSendQuote,
  useSparkLightningSendService,
} from './spark-lightning-send-service';

class SparkLightningSendCache {
  public static Key = 'spark-lightning-send';

  constructor(private readonly queryClient: QueryClient) {}

  add(request: SparkLightningSend) {
    this.queryClient.setQueryData<SparkLightningSend>(
      [SparkLightningSendCache.Key, request.id],
      request,
    );
  }
}

const useSparkLightningSendCache = () => {
  const queryClient = useQueryClient();
  return useMemo(() => new SparkLightningSendCache(queryClient), [queryClient]);
};

type GetSparkLightningSendQuoteParams = {
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
export function useGetSparkLightningSendQuote(options?: {
  onSuccess?: (quote: SparkLightningSendQuote) => void;
  onError?: (error: Error) => void;
}) {
  const sparkLightningSendService = useSparkLightningSendService();

  return useMutation({
    mutationFn: async ({
      paymentRequest,
      amount,
    }: GetSparkLightningSendQuoteParams) => {
      return sparkLightningSendService.getLightningSendQuote({
        paymentRequest,
        amount: amount as Money<'BTC'>,
      });
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  });
}

type InitiateSparkLightningSendParams = {
  /**
   * The quote for the send.
   */
  quote: SparkLightningSendQuote;
};

/**
 * Returns a mutation for initiating a Spark Lightning send request.
 */
export function useInitiateSparkLightningSend({
  onSuccess,
  onError,
}: {
  onSuccess?: (request: SparkLightningSend) => void;
  onError?: (error: Error) => void;
}) {
  const sparkLightningSendService = useSparkLightningSendService();
  const cache = useSparkLightningSendCache();

  return useMutation({
    mutationFn: async ({ quote }: InitiateSparkLightningSendParams) => {
      return sparkLightningSendService.initiateSend({
        quote,
      });
    },
    onSuccess: (request) => {
      cache.add(request);
      onSuccess?.(request);
    },
    onError,
  });
}

type TrackSparkLightningSendProps = {
  /** The ID of the Spark Lightning Send Request */
  requestId: string;
  onCompleted?: (request: SparkLightningSend) => void;
  onFailed?: (request: SparkLightningSend) => void;
};

/**
 * A hook that polls pending Spark Lightning send requests every second until the request is completed or failed.
 * @throws Error if the request is not found
 * @returns The request
 */
export function useTrackSparkLightningSend({
  requestId,
  onCompleted,
  onFailed,
}: TrackSparkLightningSendProps) {
  const sparkLightningSendService = useSparkLightningSendService();
  const onCompletedRef = useLatest(onCompleted);
  const onFailedRef = useLatest(onFailed);

  const { data: request } = useSuspenseQuery({
    queryKey: [SparkLightningSendCache.Key, requestId],
    queryFn: (): Promise<SparkLightningSend> =>
      sparkLightningSendService.get(requestId),
    refetchInterval: (query) => {
      if (query.state.data?.state === 'PENDING') {
        return 1000;
      }
      return false;
    },
  });

  useEffect(() => {
    if (request.state === 'COMPLETED') {
      onCompletedRef.current?.(request);
    } else if (request.state === 'FAILED') {
      onFailedRef.current?.(request);
    }
  }, [request]);

  return { request };
}
