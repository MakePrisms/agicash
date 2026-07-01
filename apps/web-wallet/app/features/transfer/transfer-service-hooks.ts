import { TransferService } from '@agicash/wallet-sdk/temporary';
import { useCashuReceiveQuoteService } from '../receive/cashu-receive-quote-hooks';
import { useSparkReceiveQuoteService } from '../receive/spark-receive-quote-hooks';
import { useCashuSendQuoteService } from '../send/cashu-send-quote-hooks';
import { useSparkSendQuoteService } from '../send/spark-send-quote-hooks';

export function useTransferService() {
  const cashuReceiveQuoteService = useCashuReceiveQuoteService();
  const sparkReceiveQuoteService = useSparkReceiveQuoteService();
  const cashuSendQuoteService = useCashuSendQuoteService();
  const sparkSendQuoteService = useSparkSendQuoteService();
  return new TransferService(
    cashuReceiveQuoteService,
    sparkReceiveQuoteService,
    cashuSendQuoteService,
    sparkSendQuoteService,
  );
}
