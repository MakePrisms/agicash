import { AccountService } from '@agicash/wallet-sdk/temporary';
import { useAccountRepository } from './account-repository-hooks';

export function useAccountService() {
  const accountRepository = useAccountRepository();
  return new AccountService(accountRepository);
}
