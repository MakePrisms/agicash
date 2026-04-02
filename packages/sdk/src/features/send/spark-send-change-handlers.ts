import type { AgicashDbSparkSendQuote } from '../../db/database';
import type { DatabaseChangeHandler } from '../wallet/database-change-handler';
import type { UnresolvedSparkSendQuotesCache } from './spark-send-quote-queries';
import type { SparkSendQuoteRepository } from './spark-send-quote-repository';

export function createSparkSendQuoteChangeHandlers(
  sparkSendQuoteRepo: SparkSendQuoteRepository,
  unresolvedSparkSendQuotesCache: UnresolvedSparkSendQuotesCache,
): DatabaseChangeHandler[] {
  return [
    {
      event: 'SPARK_SEND_QUOTE_CREATED',
      handleEvent: async (payload) => {
        const quote = await sparkSendQuoteRepo.toQuote(
          payload as AgicashDbSparkSendQuote,
        );
        unresolvedSparkSendQuotesCache.add(quote);
      },
    },
    {
      event: 'SPARK_SEND_QUOTE_UPDATED',
      handleEvent: async (payload) => {
        const quote = await sparkSendQuoteRepo.toQuote(
          payload as AgicashDbSparkSendQuote,
        );
        if (quote.state === 'UNPAID' || quote.state === 'PENDING') {
          unresolvedSparkSendQuotesCache.update(quote);
        } else {
          unresolvedSparkSendQuotesCache.remove(quote);
        }
      },
    },
  ];
}
