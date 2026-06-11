// The CashuReceiveQuoteService class moved to @agicash/wallet-sdk; the
// re-export is removed in the import-cleanup PR.
import { CashuReceiveQuoteService } from '@agicash/wallet-sdk/receive/cashu-receive-quote-service';
import { useCashuCryptography } from '../shared/cashu';
import { useCashuReceiveQuoteRepository } from './cashu-receive-quote-repository';

export * from '@agicash/wallet-sdk/receive/cashu-receive-quote-service';

/**
 * Transitional: construction moves behind sdk.receive in the receive-api
 * chunk; the hook exists only for the not-yet-migrated receive hooks/UI.
 */
export function useCashuReceiveQuoteService() {
  const cryptography = useCashuCryptography();
  const cashuReceiveQuoteRepository = useCashuReceiveQuoteRepository();
  return new CashuReceiveQuoteService(
    cryptography,
    cashuReceiveQuoteRepository,
  );
}
