// The SparkSendQuoteRepository class moved to @agicash/wallet-sdk; the
// re-export is removed in the import-cleanup PR.
import { SparkSendQuoteRepository } from '@agicash/wallet-sdk/send/spark-send-quote-repository';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption';

export * from '@agicash/wallet-sdk/send/spark-send-quote-repository';

/**
 * Transitional: construction moves behind sdk.send in the send-api chunk;
 * the hook exists only for the not-yet-migrated send hooks/UI.
 */
export function useSparkSendQuoteRepository() {
  const encryption = useEncryption();
  return new SparkSendQuoteRepository(agicashDbClient, encryption);
}
