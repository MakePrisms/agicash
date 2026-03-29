export { CashuReceiveQuoteService } from '@agicash/sdk/features/receive/cashu-receive-quote-service';

import { useCashuCryptography } from '../shared/cashu';
import { CashuReceiveQuoteService } from '@agicash/sdk/features/receive/cashu-receive-quote-service';
import { useCashuReceiveQuoteRepository } from './cashu-receive-quote-repository';

export function useCashuReceiveQuoteService() {
  const cryptography = useCashuCryptography();
  const cashuReceiveQuoteRepository = useCashuReceiveQuoteRepository();
  return new CashuReceiveQuoteService(
    cryptography,
    cashuReceiveQuoteRepository,
  );
}
