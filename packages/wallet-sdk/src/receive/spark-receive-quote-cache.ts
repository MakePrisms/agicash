import type { AgicashDbSparkReceiveQuote } from '@agicash/db-types';
import type { QueryClient } from '@tanstack/query-core';
import type { SparkReceiveQuote } from './spark-receive-quote';
import type { SparkReceiveQuoteRepository } from './spark-receive-quote-repository';

export class SparkReceiveQuoteCache {
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

export function createSparkReceiveQuoteChangeHandlers(
  sparkReceiveQuoteRepository: SparkReceiveQuoteRepository,
  sparkReceiveQuoteCache: SparkReceiveQuoteCache,
  pendingQuotesCache: PendingSparkReceiveQuotesCache,
) {
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
