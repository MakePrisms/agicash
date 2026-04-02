import type { AgicashDbSparkReceiveQuote } from '../../db/database';
import type { DatabaseChangeHandler } from '../wallet/database-change-handler';
import type {
  PendingSparkReceiveQuotesCache,
  SparkReceiveQuoteCache,
} from './spark-receive-queries';
import type { SparkReceiveQuoteRepository } from './spark-receive-quote-repository';

export function createSparkReceiveQuoteChangeHandlers(
  sparkReceiveQuoteRepo: SparkReceiveQuoteRepository,
  sparkReceiveQuoteCache: SparkReceiveQuoteCache,
  pendingSparkReceiveQuotesCache: PendingSparkReceiveQuotesCache,
): DatabaseChangeHandler[] {
  return [
    {
      event: 'SPARK_RECEIVE_QUOTE_CREATED',
      handleEvent: async (payload) => {
        const quote = await sparkReceiveQuoteRepo.toQuote(
          payload as AgicashDbSparkReceiveQuote,
        );
        pendingSparkReceiveQuotesCache.add(quote);
      },
    },
    {
      event: 'SPARK_RECEIVE_QUOTE_UPDATED',
      handleEvent: async (payload) => {
        const quote = await sparkReceiveQuoteRepo.toQuote(
          payload as AgicashDbSparkReceiveQuote,
        );
        sparkReceiveQuoteCache.updateIfExists(quote);
        if (quote.state === 'UNPAID') {
          pendingSparkReceiveQuotesCache.update(quote);
        } else {
          pendingSparkReceiveQuotesCache.remove(quote);
        }
      },
    },
  ];
}
