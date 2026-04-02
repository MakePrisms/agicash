import {
  type Account,
  type AccountPurpose,
  type AccountType,
  type CashuAccount,
  type ExtendedAccount,
  type SparkAccount,
  getAccountBalance,
} from '@agicash/sdk/features/accounts/account';
import {
  AccountsCache,
  listAccountsQuery,
} from '@agicash/sdk/features/accounts/account-queries';
import { AccountService } from '@agicash/sdk/features/accounts/account-service';
import { type Currency, Money } from '@agicash/sdk/lib/money/index';
import {
  type UseSuspenseQueryResult,
  useMutation,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { useUser } from '../user/user-hooks';
import { useWalletClient } from '../wallet/wallet-client';

export { AccountsCache };

export function useAccountsCache() {
  const wallet = useWalletClient();
  return wallet.caches.accounts;
}

export const accountsQueryOptions = listAccountsQuery;

/**
 * Filter options for `useAccounts` hook.
 * Results are sorted by creation date (oldest first).
 */
type UseAccountsSelect<
  T extends AccountType = AccountType,
  P extends AccountPurpose = AccountPurpose,
> = P extends 'gift-card'
  ? {
      /** Filter by currency (e.g., 'BTC', 'USD') */
      currency?: Currency;
      /** Must be 'cashu' when purpose is 'gift-card'. */
      type?: 'cashu';
      /** Filter by online status */
      isOnline?: boolean;
      /** Filter for gift-card accounts. Returns `CashuAccount[]` since gift cards are always cashu. */
      purpose: P;
    }
  : {
      /** Filter by currency (e.g., 'BTC', 'USD') */
      currency?: Currency;
      /** Filter by account type ('cashu' | 'spark'). Narrows the return type. */
      type?: T;
      /** Filter by online status */
      isOnline?: boolean;
      /** Filter by purpose. When omitted or 'transactional', any account type is allowed. */
      purpose?: P;
    };

export function useAccounts(
  select: UseAccountsSelect<'cashu', 'gift-card'>,
): UseSuspenseQueryResult<ExtendedAccount<'cashu'>[]>;
export function useAccounts<
  T extends AccountType = AccountType,
  P extends AccountPurpose = AccountPurpose,
>(
  select?: UseAccountsSelect<T, P>,
): UseSuspenseQueryResult<ExtendedAccount<T>[]>;
export function useAccounts<
  T extends AccountType = AccountType,
  P extends AccountPurpose = AccountPurpose,
>(
  select?: UseAccountsSelect<T, P>,
): UseSuspenseQueryResult<ExtendedAccount<T>[]> {
  const user = useUser();
  const wallet = useWalletClient();

  const { currency, type, isOnline, purpose } = select ?? {};

  return useSuspenseQuery({
    ...wallet.queries.listAccountsQuery(),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    select: useCallback(
      (data: Account[]) => {
        const extendedData = AccountService.getExtendedAccounts(user, data);

        const sortedData = extendedData
          .slice()
          .sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          ) as ExtendedAccount<T>[];

        if (!currency && !type && isOnline === undefined && !purpose) {
          return sortedData;
        }

        return sortedData.filter((account) => {
          if (currency && account.currency !== currency) {
            return false;
          }
          if (type && account.type !== type) {
            return false;
          }
          if (isOnline !== undefined && account.isOnline !== isOnline) {
            return false;
          }
          if (purpose && account.purpose !== purpose) {
            return false;
          }
          return true;
        });
      },
      [currency, type, isOnline, purpose, user],
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

/**
 * Hook to get an account by ID or fall back to the default account.
 * @param accountId - Optional account ID. If not provided or account not found, returns the default account.
 * @returns The matching account or the default account.
 */
export function useAccountOrDefault(accountId: string | null) {
  const { data: accounts } = useAccounts();
  const defaultAccount = useDefaultAccount();

  return accountId
    ? (accounts.find((a) => a.id === accountId) ?? defaultAccount)
    : defaultAccount;
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
 * Hook to get the sum of all transactional account balances for a given currency.
 * Null balances are ignored.
 */
export function useBalance(currency: Currency) {
  const { data: accounts } = useAccounts({
    currency,
    purpose: 'transactional',
  });
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

export function useAccountRepository() {
  const { accountRepo } = useWalletClient().repos;
  return accountRepo;
}

export function useAccountService() {
  const { accountService } = useWalletClient().services;
  return accountService;
}
