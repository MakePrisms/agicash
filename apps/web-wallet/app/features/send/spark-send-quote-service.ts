// The SparkSendQuoteService class moved to @agicash/wallet-sdk; the
// re-export is removed in the import-cleanup PR.
import { SparkSendQuoteService } from '@agicash/wallet-sdk/send/spark-send-quote-service';
import { useSparkSendQuoteRepository } from './spark-send-quote-repository';

export * from '@agicash/wallet-sdk/send/spark-send-quote-service';

/**
 * Transitional: construction moves behind sdk.send in the send-api chunk;
 * the hook exists only for the not-yet-migrated send hooks/UI.
 */
export function useSparkSendQuoteService() {
  const repository = useSparkSendQuoteRepository();
  return new SparkSendQuoteService(repository);
}
