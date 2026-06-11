// The CashuSendQuoteService class moved to @agicash/wallet-sdk; the
// re-export is removed in the import-cleanup PR.
import { CashuSendQuoteService } from '@agicash/wallet-sdk/send/cashu-send-quote-service';
import { useCashuSendQuoteRepository } from './cashu-send-quote-repository';

export * from '@agicash/wallet-sdk/send/cashu-send-quote-service';

/**
 * Transitional: construction moves behind sdk.send in the send-api chunk;
 * the hook exists only for the not-yet-migrated send hooks/UI.
 */
export function useCashuSendQuoteService() {
  const cashuSendQuoteRepository = useCashuSendQuoteRepository();
  return new CashuSendQuoteService(cashuSendQuoteRepository);
}
