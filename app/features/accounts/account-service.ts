export { AccountService } from '@agicash/core/features/accounts/account-service';
import { AccountService } from '@agicash/core/features/accounts/account-service';
import { useAccountRepository } from './account-repository';

export function useAccountService() {
  const accountRepository = useAccountRepository();
  return new AccountService(accountRepository);
}
