export { CashuReceiveQuoteRepository } from '@agicash/core/features/receive/cashu-receive-quote-repository';
import { CashuReceiveQuoteRepository } from '@agicash/core/features/receive/cashu-receive-quote-repository';
import { useAccountRepository } from '../accounts/account-repository';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption';

export function useCashuReceiveQuoteRepository() {
  const encryption = useEncryption();
  const accountRepository = useAccountRepository();
  return new CashuReceiveQuoteRepository(
    agicashDbClient,
    encryption,
    accountRepository,
  );
}
