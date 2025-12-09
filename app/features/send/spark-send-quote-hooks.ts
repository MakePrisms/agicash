import {
  type QueryClient,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Money } from '~/lib/money';
import { useAccounts } from '../accounts/account-hooks';
import {
  type SparkLightningQuote,
  type SparkSendQuote,
  useSparkSendQuoteService,
} from './spark-send-quote-service';

class SparkSendQuoteCache {
  public static Key = 'spark-lightning-send';

  constructor(private readonly queryClient: QueryClient) {}

  add(request: SparkSendQuote) {
    this.queryClient.setQueryData<SparkSendQuote>(
      [SparkSendQuoteCache.Key, request.id],
      request,
    );
  }
}

const useSparkSendQuoteCache = () => {
  const queryClient = useQueryClient();
  return useMemo(() => new SparkSendQuoteCache(queryClient), [queryClient]);
};

type GetSparkSendQuoteParams = {
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
  const { data: sparkAccounts } = useAccounts({ type: 'spark' });

  return useMutation({
    mutationFn: async ({ paymentRequest, amount }: GetSparkSendQuoteParams) => {
      return sparkSendQuoteService.getLightningSendQuote({
        account: sparkAccounts[0],
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
   * The quote for the send.
   */
  quote: SparkLightningQuote;
};

/**
 * Returns a mutation for initiating a Spark Lightning send request.
 */
export function useInitiateSparkSendQuote({
  onSuccess,
  onError,
}: {
  onSuccess?: (request: SparkSendQuote) => void;
  onError?: (error: Error) => void;
}) {
  const sparkSendQuoteService = useSparkSendQuoteService();
  const cache = useSparkSendQuoteCache();
  const { data: sparkAccounts } = useAccounts({ type: 'spark' });

  return useMutation({
    mutationFn: async ({ quote }: InitiateSparkSendQuoteParams) => {
      return sparkSendQuoteService.initiateSend({
        account: sparkAccounts[0],
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

type TrackSparkSendQuoteProps = {
  /** The ID of the Spark Lightning Send Request */
  requestId: string;
  onCompleted?: (request: SparkSendQuote) => void;
  onFailed?: (request: SparkSendQuote) => void;
};

/**
 * A hook that polls pending Spark Lightning send requests every second until the request is completed or failed.
 * @throws Error if the request is not found
 * @returns The request
 */
export function useTrackSparkSendQuote({
  requestId,
}: TrackSparkSendQuoteProps) {
  const sparkSendQuoteService = useSparkSendQuoteService();
  const { data: sparkAccounts } = useAccounts({ type: 'spark' });

  const { data: request } = useSuspenseQuery({
    queryKey: [SparkSendQuoteCache.Key, requestId],
    queryFn: (): Promise<SparkSendQuote> =>
      sparkSendQuoteService.get(sparkAccounts[0], requestId),
    refetchInterval: (query) => {
      if (query.state.data?.state === 'PENDING') {
        return 1000;
      }
      return false;
    },
  });

  return { request };
}
