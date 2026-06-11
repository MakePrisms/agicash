// The CashuReceiveQuoteRepository class moved to @agicash/wallet-sdk; the
// re-export is removed in the import-cleanup PR.
import { CashuReceiveQuoteRepository } from '@agicash/wallet-sdk/receive/cashu-receive-quote-repository';
import { useAccountRepository } from '../accounts/account-repository';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption';

export * from '@agicash/wallet-sdk/receive/cashu-receive-quote-repository';

/**
 * Transitional: construction moves behind sdk.receive in the receive-api
 * chunk; the hook exists only for the not-yet-migrated receive hooks/UI.
 */
export function useCashuReceiveQuoteRepository() {
  const encryption = useEncryption();
  const accountRepository = useAccountRepository();
  return new CashuReceiveQuoteRepository(
    agicashDbClient,
    encryption,
    accountRepository,
  );
}
