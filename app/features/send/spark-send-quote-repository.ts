export { SparkSendQuoteRepository } from '@agicash/sdk/features/send/spark-send-quote-repository';
import { SparkSendQuoteRepository } from '@agicash/sdk/features/send/spark-send-quote-repository';
import { useEncryption } from '../shared/encryption';
import { agicashDbClient } from '../agicash-db/database.client';

export function useSparkSendQuoteRepository() {
  const encryption = useEncryption();
  return new SparkSendQuoteRepository(agicashDbClient, encryption);
}
