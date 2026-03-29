export {
  CashuSendQuoteService,
  type GetCashuLightningQuoteOptions,
  type CashuLightningQuote,
  type SendQuoteRequest,
} from '@agicash/sdk/features/send/cashu-send-quote-service';
import { CashuSendQuoteService } from '@agicash/sdk/features/send/cashu-send-quote-service';
import { useCashuSendQuoteRepository } from './cashu-send-quote-repository';

export function useCashuSendQuoteService() {
  const cashuSendQuoteRepository = useCashuSendQuoteRepository();
  return new CashuSendQuoteService(cashuSendQuoteRepository);
}
