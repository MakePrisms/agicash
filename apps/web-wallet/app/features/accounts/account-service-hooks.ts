import { AccountService } from '@agicash/wallet-sdk/temporary';
import type { QueryClient } from '@tanstack/react-query';
import { useAccountRepository } from './account-repository-hooks';

export function useAccountService(queryClient: QueryClient) {
  const accountRepository = useAccountRepository();
  return new AccountService(accountRepository, queryClient);
}
