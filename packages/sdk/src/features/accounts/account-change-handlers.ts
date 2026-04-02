import type { AgicashDbAccountWithProofs } from '../../db/database';
import type { DatabaseChangeHandler } from '../wallet/database-change-handler';
import type { AccountsCache } from './account-queries';
import type { AccountRepository } from './account-repository';

export function createAccountChangeHandlers(
  accountRepo: AccountRepository,
  accountsCache: AccountsCache,
): DatabaseChangeHandler[] {
  return [
    {
      event: 'ACCOUNT_CREATED',
      handleEvent: async (payload) => {
        const account = await accountRepo.toAccount(
          payload as AgicashDbAccountWithProofs,
        );
        accountsCache.upsert(account);
      },
    },
    {
      event: 'ACCOUNT_UPDATED',
      handleEvent: async (payload) => {
        const account = await accountRepo.toAccount(
          payload as AgicashDbAccountWithProofs,
        );
        accountsCache.update(account);
      },
    },
  ];
}
