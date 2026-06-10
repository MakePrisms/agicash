// The AccountService class moved to @agicash/wallet-sdk; the re-export is
// removed in the import-cleanup PR. The React wiring hook below stays in the
// web app.
import { AccountService } from '@agicash/wallet-sdk/accounts/account-service';
import type { QueryClient } from '@tanstack/react-query';
import { useAccountRepository } from './account-repository';

export * from '@agicash/wallet-sdk/accounts/account-service';

export function useAccountService(queryClient: QueryClient) {
  const accountRepository = useAccountRepository();
  return new AccountService({ accountRepository, queryClient });
}
