export {
  SparkSendQuoteService,
  type SparkLightningQuote,
} from '@agicash/sdk/features/send/spark-send-quote-service';
import { SparkSendQuoteService } from '@agicash/sdk/features/send/spark-send-quote-service';
import { useSparkSendQuoteRepository } from './spark-send-quote-repository';

export function useSparkSendQuoteService() {
  const repository = useSparkSendQuoteRepository();
  return new SparkSendQuoteService(repository);
}
