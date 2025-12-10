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
import type { AgicashDbAccountWithProofs } from '../agicash-db/database';
import { useUser } from '../user/user-hooks';
import {
  type Account,
  type AccountType,
  type CashuAccount,
  type ExtendedAccount,
  type SparkAccount,
  getAccountBalance,
} from './account';
import {
  type AccountRepository,
  useAccountRepository,
} from './account-repository';
import { AccountService, useAccountService } from './account-service';

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

  update(account: Account) {
    this.queryClient.setQueryData([AccountsCache.Key], (curr: Account[]) =>
      curr.map((x) =>
        x.id === account.id && account.version > x.version ? account : x,
      ),
    );
  }

  updateSparkBalance(account: SparkAccount) {
    this.queryClient.setQueryData([AccountsCache.Key], (curr: Account[]) =>
      curr.map((x) =>
        x.id === account.id &&
        x.type === 'spark' &&
        !(x.balance ?? Money.zero(account.currency)).equals(
          account.balance ?? Money.zero(account.currency),
        )
          ? { ...x, balance: account.balance }
          : x,
      ),
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

/**
 * Hook that returns an account change handlers.
 */
export function useAccountChangeHandlers() {
  const accountRepository = useAccountRepository();
  const accountCache = useAccountsCache();

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
        accountCache.update(updatedAccount);
      },
    },
  ];
}

export const accountsQueryOptions = ({
  userId,
  accountRepository,
}: { userId: string; accountRepository: AccountRepository }) => {
  return queryOptions({
    queryKey: [AccountsCache.Key],
    queryFn: () => accountRepository.getAll(userId),
    staleTime: Number.POSITIVE_INFINITY,
  });
};

export function useAccounts<T extends AccountType = AccountType>(select?: {
  currency?: Currency;
  type?: T;
  isOnline?: boolean;
}): UseSuspenseQueryResult<ExtendedAccount<T>[]> {
  const user = useUser();
  const accountRepository = useAccountRepository();

  const { currency, type, isOnline } = select ?? {};

  return useSuspenseQuery({
    ...accountsQueryOptions({ userId: user.id, accountRepository }),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    select: useCallback(
      (data: Account[]) => {
        const extendedData = AccountService.getExtendedAccounts(user, data);

        if (!currency && !type && isOnline === undefined) {
          return extendedData as ExtendedAccount<T>[];
        }

        const filteredData = extendedData.filter(
          (account): account is ExtendedAccount<T> => {
            if (currency && account.currency !== currency) {
              return false;
            }
            if (type && account.type !== type) {
              return false;
            }
            if (isOnline !== undefined && account.isOnline !== isOnline) {
              return false;
            }
            return true;
          },
        );

        return filteredData;
      },
      [currency, type, isOnline, user],
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
  spark: SparkAccount;
};

/**
 * Hook to get the method which returns the account from the cache or throws an error if not found.
 * @param type - The type of the account to get. If provided the type of the returned account will be narrowed.
 * @returns The method which returns the account or throws an error if the account is not found or if the account type does not match the provided type.
 */
export function useGetAccount<T extends keyof AccountTypeMap>(
  type: T,
): (id: string) => AccountTypeMap[T];
export function useGetAccount(type?: undefined): (id: string) => Account;
export function useGetAccount(type?: keyof AccountTypeMap) {
  const accountsCache = useAccountsCache();

  return useCallback(
    (id: string) => {
      const account = accountsCache.get(id);
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
 * Hook to get the method which returns the cashu account from the cache or throws an error if not found.
 * @returns The method which returns the cashu account or throws an error if the account is not found or if the account type is not cashu.
 */
export function useGetCashuAccount() {
  return useGetAccount('cashu');
}

/**
 * Hook to get the method which returns the spark account from the cache or throws an error if not found.
 * @returns The method which returns the spark account or throws an error if the account is not found or if the account type is not spark.
 */
export function useGetSparkAccount() {
  return useGetAccount('spark');
}

export function useDefaultAccount() {
  const defaultCurrency = useUser((x) => x.defaultCurrency);
  const { data: accounts } = useAccounts({ currency: defaultCurrency });

  const defaultBtcAccountId = useUser((x) => x.defaultBtcAccountId);
  const defaultUsdAccountId = useUser((x) => x.defaultUsdAccountId);

  const defaultAccount = accounts.find(
    (x) =>
      (x.currency === 'BTC' && x.id === defaultBtcAccountId) ||
      (x.currency === 'USD' && x.id === defaultUsdAccountId),
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
 * Hook to get the sum of all account balances for a given currency.
 * Null balances are ignored.
 */
export function useBalance(currency: Currency) {
  const { data: accounts } = useAccounts({ currency });
  const balance = accounts.reduce((acc, account) => {
    const accountBalance = getAccountBalance(account);
    return accountBalance !== null ? acc.add(accountBalance) : acc;
  }, Money.zero(currency));
  return balance;
}

/**
 * Hook that returns a selector function to filter out items with offline accounts.
 */
export function useSelectItemsWithOnlineAccount() {
  const accountsCache = useAccountsCache();

  return useCallback(
    <T extends { accountId: string }>(items: T[]): T[] => {
      return items.filter((item) => {
        const account = accountsCache.get(item.accountId);
        return account?.isOnline;
      });
    },
    [accountsCache],
  );
}
