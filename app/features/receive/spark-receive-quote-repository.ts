export { SparkReceiveQuoteRepository } from '@agicash/core/features/receive/spark-receive-quote-repository';
import { SparkReceiveQuoteRepository } from '@agicash/core/features/receive/spark-receive-quote-repository';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption';

export function useSparkReceiveQuoteRepository() {
  const encryption = useEncryption();
  return new SparkReceiveQuoteRepository(agicashDbClient, encryption);
}
