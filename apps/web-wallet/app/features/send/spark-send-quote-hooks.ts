import type { SparkLightningQuote } from '@agicash/wallet-sdk';
import type { Money } from '@agicash/money';
import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { getSdk } from '~/lib/sdk';
import type { SparkAccount } from '../accounts/account';
import { DomainError } from '../shared/error';
import type { SparkSendQuote } from './spark-send-quote';

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

export function useWireSparkSendQuoteEvents() {
  const unresolvedQuotesCache = useUnresolvedSparkSendQuotesCache();

  useEffect(() => {
    const sdk = getSdk();
    const unsubscribers = [
      sdk.on('spark-send-quote:created', ({ entity }) => {
        unresolvedQuotesCache.add(entity);
      }),
      sdk.on('spark-send-quote:updated', ({ entity }) => {
        const isQuoteStillUnresolved =
          entity.state === 'UNPAID' || entity.state === 'PENDING';
        if (isQuoteStillUnresolved) {
          unresolvedQuotesCache.update(entity);
        } else {
          unresolvedQuotesCache.remove(entity);
        }
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [unresolvedQuotesCache]);
}

type CreateSparkLightningSendQuoteParams = {
  /**
   * The Spark account to send from.
   */
  account: SparkAccount;
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
 * Returns a mutation for creating a Spark Lightning send quote.
 */
export function useCreateSparkLightningSendQuote() {
  return useMutation({
    mutationFn: async ({
      account,
      paymentRequest,
      amount,
    }: CreateSparkLightningSendQuoteParams) => {
      return getSdk().spark.send.createLightningQuote({
        account,
        paymentRequest,
        amount: amount as Money<'BTC'>,
      });
    },
    retry: (failureCount, error) => {
      if (error instanceof DomainError) {
        return false;
      }
      return failureCount < 1;
    },
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
  return useMutation({
    scope: {
      id: 'create-spark-send-quote',
    },
    mutationFn: ({ account, quote }: CreateSparkSendQuoteParams) => {
      // Create-only: the SDK leader initiates the lightning payment asynchronously.
      return getSdk().spark.send.execute({
        account,
        quote,
      });
    },
    onSuccess: (data) => {
      onSuccess(data);
    },
    onError,
    retry: (failureCount, error) => {
      if (error instanceof DomainError) {
        return false;
      }
      return failureCount < 1;
    },
  });
}
