import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import {
  type QueryClient,
  type UseSuspenseQueryResult,
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import { type Currency, Money } from '~/lib/money';
import { useSupabaseRealtime } from '~/lib/supabase';
import { useLatest } from '~/lib/use-latest';
import { type AgicashDbAccount, agicashRealtime } from '../agicash-db/database';
import { useUser } from '../user/user-hooks';
import {
  type Account,
  type AccountType,
  type CashuAccount,
  type ExtendedAccount,
  getAccountBalance,
  isStarAccount,
} from './account';
import {
  type AccountRepository,
  useAccountRepository,
} from './account-repository';
import { AccountService, useAccountService } from './account-service';

export const accountsQueryKey = 'accounts';
const accountVersionsQueryKey = 'account-versions';

/**
 * Cache that stores the latest known version of each account.
 * This is used when we have the information about the latest version of the account before we have the full account data.
 */
class AccountVersionsCache {
  constructor(
    private readonly queryClient: QueryClient,
    private readonly accountsCache: AccountsCache,
  ) {}

  /**
   * Get the latest known version of the account.
   * @param accountId - The id of the account.
   * @returns The latest known version of the account or -1 if the account is not found.
   */
  getLatestVersion(accountId: string) {
    const version = this.queryClient.getQueryData<number>([
      accountVersionsQueryKey,
      accountId,
    ]);

    if (version) {
      return version;
    }

    const account = this.accountsCache.get(accountId);
    if (!account) {
      return -1;
    }

    return account.version;
  }

  /**
   * Update the latest known version of the account if it is stale.
   * @param accountId - The id of the account.
   * @param version - The new version of the account. If the version passed is lower than the latest known version, it will be ignored.
   */
  updateLatestVersionIfStale(accountId: string, version: number) {
    const latestVersion = this.getLatestVersion(accountId);
    if (latestVersion < version) {
      this.queryClient.setQueryData<number>(
        [accountVersionsQueryKey, accountId],
        version,
      );
    }
  }
}

export class AccountsCache {
  private readonly accountVersionsCache;

  constructor(private readonly queryClient: QueryClient) {
    this.accountVersionsCache = new AccountVersionsCache(queryClient, this);
  }

  upsert(account: Account) {
    this.accountVersionsCache.updateLatestVersionIfStale(
      account.id,
      account.version,
    );

    this.queryClient.setQueryData([accountsQueryKey], (curr: Account[]) => {
      const existingAccountIndex = curr.findIndex((x) => x.id === account.id);
      if (existingAccountIndex !== -1) {
        return curr.map((x) => (x.id === account.id ? account : x));
      }
      return [...curr, account];
    });
  }

  update(account: Account) {
    this.accountVersionsCache.updateLatestVersionIfStale(
      account.id,
      account.version,
    );

    this.queryClient.setQueryData([accountsQueryKey], (curr: Account[]) =>
      curr.map((x) => (x.id === account.id ? account : x)),
    );
  }

  /**
   * Gets all accounts.
   * Each account returned is the last version for which we have a full account data.
   * @returns The list of accounts.
   */
  getAll() {
    return this.queryClient.getQueryData<Account[]>([accountsQueryKey]);
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
   * Set the latest known version of an account.
   * Use when we know the latest version of an account before we can update the account data in cache. `getLatest` can then be used to wait for the account to be updated with the latest data.
   * @param id - The id of the account.
   * @param version - The new version of the account. If the version passed is lower than the latest known version, it will be ignored.
   */
  setLatestVersion(id: string, version: number) {
    this.accountVersionsCache.updateLatestVersionIfStale(id, version);
  }

  /**
   * Get the latest account by id.
   * Returns the latest version of the account. If we don't have the full data for the latest known version yet, this will wait for the account data to be updated.
   * @param id - The id of the account.
   * @returns The latest account or null if the account is not found.
   */
  async getLatest(id: string): Promise<Account | null> {
    const latestKnownVersion = this.accountVersionsCache.getLatestVersion(id);

    const account = this.get(id);
    if (!account || account.version >= latestKnownVersion) {
      return account;
    }

    return new Promise<Account | null>((resolve) => {
      const unsubscribe = this.subscribe((accounts) => {
        const updatedAccount = accounts.find((x) => x.id === id);
        if (!updatedAccount) {
          resolve(null);
          unsubscribe();
          return;
        }

        if (updatedAccount.version >= latestKnownVersion) {
          this.accountVersionsCache.updateLatestVersionIfStale(
            id,
            updatedAccount.version,
          );
          resolve(updatedAccount);
          unsubscribe();
        }
      });
    });
  }

  /**
   * Subscribe to changes in the accounts cache.
   * @param callback - The callback to call when the accounts cache changes.
   * @returns A function to unsubscribe from the accounts cache.
   */
  private subscribe(callback: (accounts: Account[]) => void) {
    const cache = this.queryClient.getQueryCache();
    return cache.subscribe((event) => {
      if (
        event.query.queryKey.length === 1 &&
        event.query.queryKey[0] === accountsQueryKey
      ) {
        callback(event.query.state.data);
      }
    });
  }
}

/**
 * Hook that provides the accounts cache.
 * Reference of the returned data is stable as long as the logged in user doesn't change (see App component in root.tsx).
 * @returns The accounts cache.
 */
export function useAccountsCache() {
  const queryClient = useQueryClient();
  // The query client is a singleton created in the root of the app (see App component in root.tsx).
  return useMemo(() => new AccountsCache(queryClient), [queryClient]);
}

function useOnAccountChange({
  onCreated,
  onUpdated,
}: {
  onCreated: (account: Account) => void;
  onUpdated: (account: Account) => void;
}) {
  const accountRepository = useAccountRepository();
  const accountCache = useAccountsCache();
  const queryClient = useQueryClient();

  const changeHandlerRef = useLatest(
    async (payload: RealtimePostgresChangesPayload<AgicashDbAccount>) => {
      if (payload.eventType === 'INSERT') {
        const addedAccount = await accountRepository.toAccount(payload.new);
        onCreated(addedAccount);
      } else if (payload.eventType === 'UPDATE') {
        // We are updating the latest known version of the account here so anyone who needs the latest version (who uses account cache `getLatest`)
        // can know as soon as possible and thus can wait for the account data to be decrypted and updated in the cache instead of processing the old version.
        accountCache.setLatestVersion(payload.new.id, payload.new.version);

        const updatedAccount = await accountRepository.toAccount(payload.new);

        onUpdated(updatedAccount);
      }
    },
  );

  return useSupabaseRealtime({
    channel: agicashRealtime.channel('accounts').on<AgicashDbAccount>(
      'postgres_changes',
      {
        event: '*',
        schema: 'wallet',
        table: 'accounts',
      },
      (payload) => changeHandlerRef.current(payload),
    ),
    onConnected: () => {
      // Invalidate the accounts query so that the accounts are re-fetched and the cache is updated.
      // This is needed to get any data that might have been updated while the re-connection was in progress.
      queryClient.invalidateQueries({ queryKey: [accountsQueryKey] });
    },
  });
}

export function useTrackAccounts() {
  // Makes sure the accounts are loaded in the cache.
  useAccounts();

  const accountCache = useAccountsCache();

  return useOnAccountChange({
    onCreated: (account) => accountCache.upsert(account),
    onUpdated: (account) => accountCache.update(account),
  });
}

export const accountsQueryOptions = ({
  userId,
  accountRepository,
}: { userId: string; accountRepository: AccountRepository }) => {
  return queryOptions({
    queryKey: [accountsQueryKey],
    queryFn: () => accountRepository.getAll(userId),
    staleTime: Number.POSITIVE_INFINITY,
  });
};

export function useAccounts<T extends AccountType = AccountType>(select?: {
  currency?: Currency;
  type?: T;
  excludeStarAccounts?: boolean;
  starAccountsOnly?: boolean;
}): UseSuspenseQueryResult<ExtendedAccount<T>[]> {
  const user = useUser();
  const accountRepository = useAccountRepository();

  return useSuspenseQuery({
    ...accountsQueryOptions({ userId: user.id, accountRepository }),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    select: useCallback(
      (data: Account[]) => {
        const extendedData = AccountService.getExtendedAccounts(user, data);

        if (!select?.currency && !select?.type) {
          return extendedData as ExtendedAccount<T>[];
        }

        const filteredData = extendedData.filter(
          (account): account is ExtendedAccount<T> => {
            if (select.currency && account.currency !== select.currency) {
              return false;
            }
            if (select.type && account.type !== select.type) {
              return false;
            }
            if (select.excludeStarAccounts && isStarAccount(account)) {
              return false;
            }
            if (select.starAccountsOnly && !isStarAccount(account)) {
              return false;
            }
            return true;
          },
        );

        return filteredData;
      },
      [
        select?.currency,
        select?.type,
        select?.excludeStarAccounts,
        select?.starAccountsOnly,
        user,
      ],
    ),
  });
}

/**
 * Hook to get an account by ID.
 * @param id - The ID of the account to retrieve.
 * @returns The specified account.
 * @throws Error if the account is not found.
 */
export function useAccount<T extends AccountType = AccountType>(id: string) {
  const { data: accounts } = useAccounts<T>();
  const account = accounts.find((x) => x.id === id);

  if (!account) {
    throw new Error(`Account with id ${id} not found`);
  }

  return account;
}

type AccountTypeMap = {
  cashu: CashuAccount;
};

/**
 * Hook to get the method which return the latest version of the account.
 * If we know that the account was updated but we don't have the full account data yet, we can use this hook to wait for the account data to be updated in the cache.
 * Prefer using this hook whenever using the account's version property to minimize the errors that result in retries which are caused by using the old version of the account.
 * @param type - The type of the account to get the latest version of. If provided the type of the returned account will be narrowed.
 * @returns The latest version of the account.
 * @throws Error if the account is not found.
 */
export function useGetLatestAccount<T extends keyof AccountTypeMap>(
  type: T,
): (id: string) => Promise<AccountTypeMap[T]>;
export function useGetLatestAccount(
  type?: undefined,
): (id: string) => Promise<Account>;
export function useGetLatestAccount(type?: keyof AccountTypeMap) {
  const accountsCache = useAccountsCache();

  return useCallback(
    async (id: string) => {
      const account = await accountsCache.getLatest(id);
      if (!account) {
        throw new Error(`Account not found for id: ${id}`);
      }
      if (type && account.type !== type) {
        throw new Error(`Account with id: ${id} is not of type: ${type}`);
      }
      return account;
    },
    [accountsCache, type],
  );
}

/**
 * Hook to get the method which return the latest version of the cashu account.
 * If we know that the account was updated but we don't have the full account data yet, we can use this hook to wait for the account data to be updated in the cache.
 * Prefer using this hook whenever using the account's version property to minimize the errors that result in retries which are caused by using the old version of the account.
 * @returns The latest version of the cashu account.
 * @throws Error if the account is not found.
 */
export function useGetLatestCashuAccount() {
  return useGetLatestAccount('cashu');
}

export function useDefaultAccount() {
  const defaultCurrency = useUser((x) => x.defaultCurrency);
  const { data: accounts } = useAccounts({ currency: defaultCurrency });

  const defaultBtcAccountId = useUser((x) => x.defaultBtcAccountId);
  const defaultUsdccountId = useUser((x) => x.defaultUsdAccountId);

  const defaultAccount = accounts.find(
    (x) =>
      (x.currency === 'BTC' && x.id === defaultBtcAccountId) ||
      (x.currency === 'USD' && x.id === defaultUsdccountId),
  );

  // In the case that there are multiple instances of the app open and the user creates a new account and sets it as default,
  // the user's default account ID might be updated before the new account is propagated to other instances.
  // This is a fallback to maintain the previous default account until the new account is propagated.
  const previousDefaultAccountIdRef = useRef(defaultAccount?.id);

  if (!defaultAccount) {
    // prefer the previous default account if available, otherwise use first account with the user's default currency
    const fallbackAccount =
      accounts.find((x) => x.id === previousDefaultAccountIdRef.current) ??
      accounts.find((x) => x.currency === defaultCurrency);
    if (!fallbackAccount) {
      throw new Error(
        `No default account found for currency ${defaultCurrency}`,
      );
    }
    return fallbackAccount;
  }

  previousDefaultAccountIdRef.current = defaultAccount?.id;
  return defaultAccount;
}

export function useAddCashuAccount() {
  const userId = useUser((x) => x.id);
  const accountCache = useAccountsCache();
  const accountService = useAccountService();

  const { mutateAsync } = useMutation({
    mutationFn: async (
      account: Parameters<typeof accountService.addCashuAccount>[0]['account'],
    ) => accountService.addCashuAccount({ userId, account }),
    onSuccess: (account) => {
      // We add the account as soon as it is created so that it is available in the cache immediately.
      // This is important when using other hooks that are trying to use the account immediately after it is created.
      accountCache.upsert(account);
    },
  });

  return mutateAsync;
}

/**
 * @returns the total balance of all accounts for the given currency excluding Star accounts.
 */
export function useBalance(currency: Currency) {
  const { data: accounts } = useAccounts({
    currency,
    excludeStarAccounts: true,
  });
  const balance = accounts.reduce((acc, account) => {
    const accountBalance = getAccountBalance(account);
    return acc.add(accountBalance);
  }, Money.zero(currency));
  return balance;
}
