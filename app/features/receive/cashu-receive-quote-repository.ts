export { CashuReceiveQuoteRepository } from '@agicash/sdk/features/receive/cashu-receive-quote-repository';

import { CashuReceiveQuoteRepository } from '@agicash/sdk/features/receive/cashu-receive-quote-repository';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption';
import { useAccountRepository } from '../accounts/account-repository';

export function useCashuReceiveQuoteRepository() {
  const encryption = useEncryption();
  const accountRepository = useAccountRepository();
  return new CashuReceiveQuoteRepository(
    agicashDbClient,
    encryption,
    accountRepository,
  );
}
