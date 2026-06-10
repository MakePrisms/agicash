// The AccountService class moved to @agicash/wallet-sdk; the re-export is
// removed in the import-cleanup PR.
import { getSdk } from '../shared/sdk';

export * from '@agicash/wallet-sdk/accounts/account-service';

export function useAccountService() {
  return getSdk().accounts.service;
}
