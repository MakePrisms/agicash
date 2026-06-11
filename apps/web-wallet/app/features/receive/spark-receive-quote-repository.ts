// The SparkReceiveQuoteRepository class moved to @agicash/wallet-sdk; the
// re-export is removed in the import-cleanup PR.
import { SparkReceiveQuoteRepository } from '@agicash/wallet-sdk/receive/spark-receive-quote-repository';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption';

export * from '@agicash/wallet-sdk/receive/spark-receive-quote-repository';

/**
 * Transitional: construction moves behind sdk.receive in the receive-api
 * chunk; the hook exists only for the not-yet-migrated receive hooks/UI.
 */
export function useSparkReceiveQuoteRepository() {
  const encryption = useEncryption();
  return new SparkReceiveQuoteRepository(agicashDbClient, encryption);
}
