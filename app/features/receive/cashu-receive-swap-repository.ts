export { CashuReceiveSwapRepository } from '@agicash/core/features/receive/cashu-receive-swap-repository';
import { CashuReceiveSwapRepository } from '@agicash/core/features/receive/cashu-receive-swap-repository';
import { useAccountRepository } from '../accounts/account-repository';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption';

export function useCashuReceiveSwapRepository() {
  const encryption = useEncryption();
  const accountRepository = useAccountRepository();
  return new CashuReceiveSwapRepository(
    agicashDbClient,
    encryption,
    accountRepository,
  );
}
