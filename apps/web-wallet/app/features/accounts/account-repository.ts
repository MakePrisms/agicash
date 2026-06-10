// The AccountRepository class moved to @agicash/wallet-sdk; the re-export is
// removed in the import-cleanup PR.
import { getSdk } from '../shared/sdk';

export * from '@agicash/wallet-sdk/accounts/account-repository';

/**
 * Transitional (sdk.accounts.internal): only for the not-yet-migrated
 * user/receive/send repositories that take the account repository as a
 * collaborator. App/UI code must use the curated sdk.accounts methods.
 */
export function useAccountRepository() {
  return getSdk().accounts.internal.repository;
}
