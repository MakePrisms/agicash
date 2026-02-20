export {
  ReceiveCashuTokenQuoteService,
  type CrossAccountReceiveQuotesResult,
} from '@agicash/core/features/receive/receive-cashu-token-quote-service';
import { ReceiveCashuTokenQuoteService } from '@agicash/core/features/receive/receive-cashu-token-quote-service';
import { useCashuReceiveQuoteService } from './cashu-receive-quote-service';
import { useSparkReceiveQuoteService } from './spark-receive-quote-service';

export function useReceiveCashuTokenQuoteService() {
  const cashuReceiveQuoteService = useCashuReceiveQuoteService();
  const sparkLightningReceiveService = useSparkReceiveQuoteService();
  return new ReceiveCashuTokenQuoteService(
    cashuReceiveQuoteService,
    sparkLightningReceiveService,
  );
}
