// The ReceiveCashuTokenQuoteService class moved to @agicash/wallet-sdk; the
// re-export is removed in the import-cleanup PR.
import { ReceiveCashuTokenQuoteService } from '@agicash/wallet-sdk/receive/receive-cashu-token-quote-service';
import { useCashuReceiveQuoteService } from './cashu-receive-quote-service';
import { useSparkReceiveQuoteService } from './spark-receive-quote-service';

export * from '@agicash/wallet-sdk/receive/receive-cashu-token-quote-service';

/**
 * Transitional: construction moves behind sdk.receive in the receive-api
 * chunk; the hook exists only for the not-yet-migrated receive hooks/UI.
 */
export function useReceiveCashuTokenQuoteService() {
  const cashuReceiveQuoteService = useCashuReceiveQuoteService();
  const sparkLightningReceiveService = useSparkReceiveQuoteService();
  return new ReceiveCashuTokenQuoteService(
    cashuReceiveQuoteService,
    sparkLightningReceiveService,
  );
}
