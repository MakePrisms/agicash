import type { AgicashDbAccountWithProofs } from '@agicash/db-types';
import { Money } from '@agicash/utils/money';
import type { QueryClient } from '@tanstack/query-core';
import { sparkDebugLog } from '../spark-config';
import type { Account } from './account';
import type { AccountRepository } from './account-repository';

export class AccountsCache {
  public static Key = 'accounts';

  constructor(private readonly queryClient: QueryClient) {}

  upsert(account: Account) {
    this.queryClient.setQueryData([AccountsCache.Key], (curr: Account[]) => {
      const existingAccountIndex = curr.findIndex((x) => x.id === account.id);
      if (existingAccountIndex !== -1) {
        return curr.map((x) =>
          x.id === account.id && account.version > x.version ? account : x,
        );
      }
      return [...curr, account];
    });
  }

  updateSparkAccountBalance({
    accountId,
    balance,
  }: {
    accountId: string;
    balance: Money;
  }) {
    this.queryClient.setQueryData([AccountsCache.Key], (curr: Account[]) =>
      curr.map((x) => {
        if (x.id !== accountId || x.type !== 'spark') return x;

        const currentBalance = x.balance ?? Money.zero(x.currency);
        if (currentBalance.equals(balance)) return x;

        sparkDebugLog('Balance updated', {
          accountId,
          prev: currentBalance.toString(),
          new: balance.toString(),
        });

        return { ...x, balance };
      }),
    );
  }

  /**
   * Gets all accounts.
   * Each account returned is the last version for which we have a full account data.
   * @returns The list of accounts.
   */
  getAll() {
    return this.queryClient.getQueryData<Account[]>([AccountsCache.Key]);
  }

  /**
   * Get an account by id.
   * Returns the last version of the account for which we have a full account data.
   * @param id - The id of the account.
   * @returns The account or null if the account is not found.
   */
  get(id: string) {
    const accounts = this.getAll();
    return accounts?.find((x) => x.id === id) ?? null;
  }

  /**
   * Invalidates the accounts cache.
   */
  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [AccountsCache.Key],
    });
  }
}

export const accountsQueryOptions = ({
  userId,
  accountRepository,
}: { userId: string; accountRepository: AccountRepository }) => ({
  queryKey: [AccountsCache.Key],
  queryFn: () => accountRepository.getAllActive(userId),
  staleTime: Number.POSITIVE_INFINITY,
  // Refetches use `getAllActive`, so any expired account previously in the
  // cache (lazy-fetched via useAccountOrNull, or just expired before the
  // realtime ACCOUNT_UPDATED has arrived) would otherwise be wiped. Preserve
  // anything in oldData that the new fetch didn't return.
  structuralSharing: (oldData: unknown, newData: unknown) => {
    const oldAccounts = oldData as Account[] | undefined;
    const newAccounts = newData as Account[];
    if (!oldAccounts) return newAccounts;
    const newIds = new Set(newAccounts.map((a) => a.id));
    return [...newAccounts, ...oldAccounts.filter((a) => !newIds.has(a.id))];
  },
});

/**
 * Realtime account change handlers: each handler maps the broadcast DB row to
 * a full Account (repository) and upserts it into the cache (version-guarded).
 */
export function createAccountChangeHandlers(
  accountRepository: AccountRepository,
  accountCache: AccountsCache,
) {
  return [
    {
      event: 'ACCOUNT_CREATED',
      handleEvent: async (payload: AgicashDbAccountWithProofs) => {
        const addedAccount = await accountRepository.toAccount(payload);
        accountCache.upsert(addedAccount);
      },
    },
    {
      event: 'ACCOUNT_UPDATED',
      handleEvent: async (payload: AgicashDbAccountWithProofs) => {
        const updatedAccount = await accountRepository.toAccount(payload);
        accountCache.upsert(updatedAccount);
      },
    },
  ];
}
