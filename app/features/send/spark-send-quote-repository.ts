export { SparkSendQuoteRepository } from '@agicash/core/features/send/spark-send-quote-repository';
import { SparkSendQuoteRepository } from '@agicash/core/features/send/spark-send-quote-repository';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption';

export function useSparkSendQuoteRepository() {
  const encryption = useEncryption();
  return new SparkSendQuoteRepository(agicashDbClient, encryption);
}
