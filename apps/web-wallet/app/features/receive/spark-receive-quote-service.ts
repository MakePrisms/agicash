// The SparkReceiveQuoteService class moved to @agicash/wallet-sdk; the
// re-export is removed in the import-cleanup PR.
import { SparkReceiveQuoteService } from '@agicash/wallet-sdk/receive/spark-receive-quote-service';
import { useSparkReceiveQuoteRepository } from './spark-receive-quote-repository';

export * from '@agicash/wallet-sdk/receive/spark-receive-quote-service';

/**
 * Transitional: construction moves behind sdk.receive in the receive-api
 * chunk; the hook exists only for the not-yet-migrated receive hooks/UI.
 */
export function useSparkReceiveQuoteService() {
  const repository = useSparkReceiveQuoteRepository();
  return new SparkReceiveQuoteService(repository);
}
