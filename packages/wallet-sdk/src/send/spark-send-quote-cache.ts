import type { AgicashDbSparkSendQuote } from '@agicash/db-types';
import type { QueryClient } from '@tanstack/query-core';
import type { SparkSendQuote } from './spark-send-quote';
import type { SparkSendQuoteRepository } from './spark-send-quote-repository';

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

export function createSparkSendQuoteChangeHandlers(
  sparkSendQuoteRepository: SparkSendQuoteRepository,
  unresolvedQuotesCache: UnresolvedSparkSendQuotesCache,
) {
  return [
    {
      event: 'SPARK_SEND_QUOTE_CREATED',
      handleEvent: async (payload: AgicashDbSparkSendQuote) => {
        const addedQuote = await sparkSendQuoteRepository.toQuote(payload);
        unresolvedQuotesCache.add(addedQuote);
      },
    },
    {
      event: 'SPARK_SEND_QUOTE_UPDATED',
      handleEvent: async (payload: AgicashDbSparkSendQuote) => {
        const quote = await sparkSendQuoteRepository.toQuote(payload);

        const isQuoteStillUnresolved =
          quote.state === 'UNPAID' || quote.state === 'PENDING';
        if (isQuoteStillUnresolved) {
          unresolvedQuotesCache.update(quote);
        } else {
          unresolvedQuotesCache.remove(quote);
        }
      },
    },
  ];
}
