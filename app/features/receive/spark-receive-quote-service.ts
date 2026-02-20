export { SparkReceiveQuoteService } from '@agicash/core/features/receive/spark-receive-quote-service';
import { SparkReceiveQuoteService } from '@agicash/core/features/receive/spark-receive-quote-service';
import { useSparkReceiveQuoteRepository } from './spark-receive-quote-repository';

export function useSparkReceiveQuoteService() {
  const repository = useSparkReceiveQuoteRepository();
  return new SparkReceiveQuoteService(repository);
}
