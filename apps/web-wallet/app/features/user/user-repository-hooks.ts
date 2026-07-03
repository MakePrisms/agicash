import {
  ReadUserRepository,
  WriteUserRepository,
} from '@agicash/wallet-sdk/temporary';
import { useAccountRepository } from '~/features/accounts/account-repository-hooks';
import { agicashDbClient } from '~/features/agicash-db/database.client';

export function useReadUserRepository() {
  return new ReadUserRepository(agicashDbClient);
}

export function useWriteUserRepository() {
  const accountRepository = useAccountRepository();
  return new WriteUserRepository(agicashDbClient, accountRepository);
}
