export {
  WriteUserRepository,
  ReadUserDefaultAccountRepository,
  ReadUserRepository,
  type UpdateUser,
} from '@agicash/core/features/user/user-repository';
import {
  ReadUserRepository,
  WriteUserRepository,
} from '@agicash/core/features/user/user-repository';
import { useAccountRepository } from '../accounts/account-repository';
import { agicashDbClient } from '../agicash-db/database.client';

export function useReadUserRepository() {
  return new ReadUserRepository(agicashDbClient);
}

export function useWriteUserRepository() {
  const accountRepository = useAccountRepository();
  return new WriteUserRepository(agicashDbClient, accountRepository);
}
