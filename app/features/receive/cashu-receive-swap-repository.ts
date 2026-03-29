export { CashuReceiveSwapRepository } from '@agicash/sdk/features/receive/cashu-receive-swap-repository';

import { CashuReceiveSwapRepository } from '@agicash/sdk/features/receive/cashu-receive-swap-repository';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption';
import { useAccountRepository } from '../accounts/account-repository';

export function useCashuReceiveSwapRepository() {
  const encryption = useEncryption();
  const accountRepository = useAccountRepository();
  return new CashuReceiveSwapRepository(
    agicashDbClient,
    encryption,
    accountRepository,
  );
}
