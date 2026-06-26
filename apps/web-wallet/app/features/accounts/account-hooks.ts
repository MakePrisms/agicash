import { type Currency, Money } from '@agicash/money';
import {
  type QueryClient,
  type UseSuspenseQueryResult,
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import type { AgicashDbAccountWithProofs } from '../agicash-db/database';
import { sparkDebugLog } from '../shared/spark';
import { useUser } from '../user/user-hooks';
import { UserService } from '../user/user-service';
import {
  type Account,
  type AccountPurpose,
  type AccountState,
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
import { useAccountService } from './account-service';

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
        accountCache.upsert(updatedAccount);
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
    queryFn: () => accountRepository.getAllActive(userId),
    staleTime: Number.POSITIVE_INFINITY,
    // Refetches use `getAllActive`, so any expired account previously in the
    // cache (lazy-fetched via useAccountOrNull, or just expired before the
    // realtime ACCOUNT_UPDATED has arrived) would otherwise be wiped. Preserve
    // anything in oldData that the new fetch didn't return.
    structuralSharing: (oldData, newData) => {
      const oldAccounts = oldData as Account[] | undefined;
      const newAccounts = newData as Account[];
      if (!oldAccounts) return newAccounts;
      const newIds = new Set(newAccounts.map((a) => a.id));
      return [...newAccounts, ...oldAccounts.filter((a) => !newIds.has(a.id))];
    },
  });
};

/**
 * Filter options for `useAccounts` hook.
 * Results are sorted by creation date (oldest first).
 */
type UseAccountsSelect<
  T extends AccountType = AccountType,
  P extends AccountPurpose = AccountPurpose,
> = P extends 'gift-card' | 'offer'
  ? {
      /** Filter by currency (e.g., 'BTC', 'USD') */
      currency?: Currency;
      /** Must be 'cashu' when purpose is 'gift-card' or 'offer'. */
      type?: 'cashu';
      /** Filter by online status */
      isOnline?: boolean;
      /** Filter for gift-card or offer accounts. Returns `CashuAccount[]` since these are always cashu. */
      purpose: P;
      /**
       * Filter by account state. Defaults to 'active'. Pass an array to allow
       * multiple states.
       *
       * Note: this only filters what's already in the in-memory cache. Passing
       * 'expired' returns expired accounts already in the cache (from realtime
       * state transitions during the session, or from `useAccountOrNull` lazy
       * fetches) — it does not fetch the user's full expired history from the
       * database.
       */
      state?: AccountState | AccountState[];
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
      /**
       * Filter by account state. Defaults to 'active'. Pass an array to allow
       * multiple states.
       *
       * Note: this only filters what's already in the in-memory cache. Passing
       * 'expired' returns expired accounts already in the cache (from realtime
       * state transitions during the session, or from `useAccountOrNull` lazy
       * fetches) — it does not fetch the user's full expired history from the
       * database.
       *
       * When passing an array, the accounts will be filtered on every render
       * if you don't preserve the array reference.
       */
      state?: AccountState | AccountState[];
    };

/**
 * Hook to get the user's accounts, sorted by creation date (oldest first).
 *
 * Note: this hook does not fetch expired accounts from the database — the
 * cache is initially populated by `getAllActive`. Expired accounts only enter
 * the cache when (a) realtime ACCOUNT_UPDATED transitions an account from
 * active to expired during the session, or (b) {@link useAccountOrNull} lazy-fetches
 * a specific one. Passing `state: 'expired'` (or `['active', 'expired']`)
 * returns only those cached expired accounts, not the user's full expired
 * history.
 *
 * Refetches on window focus and reconnect to stay in sync with the server.
 * Expired accounts already in the cache are preserved across refetches via
 * {@link accountsQueryOptions}'s `structuralSharing`.
 *
 * @param select - Optional filters. See {@link UseAccountsSelect}.
 *   Including `purpose: 'gift-card' | 'offer'` narrows the return type to
 *   `ExtendedAccount<'cashu'>[]`.
 * @returns A `useSuspenseQuery` result whose data is the filtered accounts.
 */
export function useAccounts(
  select: UseAccountsSelect<'cashu', 'gift-card'>,
): UseSuspenseQueryResult<ExtendedAccount<'cashu'>[]>;
export function useAccounts(
  select: UseAccountsSelect<'cashu', 'offer'>,
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
  const accountRepository = useAccountRepository();

  const { currency, type, isOnline, purpose, state = 'active' } = select ?? {};

  return useSuspenseQuery({
    ...accountsQueryOptions({ userId: user.id, accountRepository }),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    select: useCallback(
      (data: Account[]) => {
        const allowedStates = Array.isArray(state) ? state : [state];
        const extendedData = UserService.getExtendedAccounts(user, data);

        const filteredData = extendedData.filter((account) => {
          if (!allowedStates.includes(account.state)) {
            return false;
          }
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

        return filteredData.sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ) as ExtendedAccount<T>[];
      },
      [currency, type, isOnline, purpose, state, user],
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

const ALL_ACCOUNT_STATES: AccountState[] = ['active', 'expired'];

/**
 * Hook to get an account by ID, or null if not found. Falls back to a DB lookup
 * when the account is not in the accounts cache, so it returns expired accounts
 * too — needed for routes that may be loaded directly (e.g. tab reload,
 * post-payment redirect) for an offer the cron job has since flipped to
 * `state='expired'`.
 *
 * The accounts cache is the single source of truth: on cache miss the queryFn
 * fetches from the DB and upserts the result back into it. The `useSuspenseQuery`
 * here is only used for deduplication and suspension — its stored value is
 * always null, so there's no second copy of the account that could drift from
 * the cache.
 * @param id - The ID of the account to retrieve.
 */
export function useAccountOrNull(id: string | null): Account | null {
  const accountsCache = useAccountsCache();
  const accountRepository = useAccountRepository();
  const { data: accounts } = useAccounts({ state: ALL_ACCOUNT_STATES });

  useSuspenseQuery({
    queryKey: ['fetch-account-by-id', id],
    queryFn: async () => {
      if (!id || accountsCache.get(id)) return null;
      const fetched = await accountRepository.get(id);
      if (fetched) accountsCache.upsert(fetched);
      return null;
    },
    // The query stores no useful data (always null); it's just a fetch + dedup
    // primitive. Don't keep the marker around once the route unmounts.
    gcTime: 0,
  });

  return id ? (accounts.find((x) => x.id === id) ?? null) : null;
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
 * Hook to get the method which returns the cashu account matching a mint URL and currency, or null if not found.
 * @returns A function that takes a mint URL and currency and returns the matching cashu account or null.
 */
export function useGetCashuAccountByMintUrlAndCurrency() {
  const accountsCache = useAccountsCache();

  return useCallback(
    (mintUrl: string, currency: Currency) =>
      accountsCache
        .getAll()
        ?.find(
          (a): a is CashuAccount =>
            a.type === 'cashu' &&
            a.mintUrl === mintUrl &&
            a.currency === currency,
        ) ?? null,
    [accountsCache],
  );
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
