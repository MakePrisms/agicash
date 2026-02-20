export { CashuReceiveQuoteService } from '@agicash/core/features/receive/cashu-receive-quote-service';
import { CashuReceiveQuoteService } from '@agicash/core/features/receive/cashu-receive-quote-service';
import { useCashuCryptography } from '../shared/cashu';
import { useCashuReceiveQuoteRepository } from './cashu-receive-quote-repository';

export function useCashuReceiveQuoteService() {
  const cryptography = useCashuCryptography();
  const cashuReceiveQuoteRepository = useCashuReceiveQuoteRepository();
  return new CashuReceiveQuoteService(
    cryptography,
    cashuReceiveQuoteRepository,
  );
}
