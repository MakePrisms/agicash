// Transitional re-export — moved to @agicash/wallet-sdk; removed in the import-cleanup PR.
export {
  ReadUserDefaultAccountRepository,
  ReadUserRepository,
  WriteUserRepository,
} from '@agicash/wallet-sdk';
import { ReadUserRepository, WriteUserRepository } from '@agicash/wallet-sdk';
import { useAccountRepository } from '../accounts/account-repository';
import { agicashDbClient } from '../agicash-db/database.client';

export function useReadUserRepository() {
  return new ReadUserRepository(agicashDbClient);
}

export function useWriteUserRepository() {
  const accountRepository = useAccountRepository();
  return new WriteUserRepository(agicashDbClient, accountRepository);
}
