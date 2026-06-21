import { type Currency, Money } from '@agicash/money';
import type { AddCashuAccountInput } from '@agicash/wallet-sdk';
import { useMutation } from '@tanstack/react-query';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import { getSdk } from '~/lib/sdk';
import { useStoreSuspense } from '~/lib/store-hooks';
import { useUser } from '../user/user-hooks';
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
import { useAccountRepository } from './account-repository';
import { AccountService } from './account-service';
import { useLiveSparkBalances } from './live-spark-balances';

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
       * Note: this only filters what's already in the in-memory store. Passing
       * 'expired' returns expired accounts already in the store (from realtime
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
       * Note: this only filters what's already in the in-memory store. Passing
       * 'expired' returns expired accounts already in the store (from realtime
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
 * Overlays the live Spark balances (tracked app-side from Breez events) onto the
 * store accounts. The store has no spark-balance row event, so its spark
 * accounts only carry the seed balance; this keeps displays live.
 */
function overlayLiveSparkBalances(
  accounts: Account[],
  liveBalances: ReadonlyMap<string, Money>,
): Account[] {
  if (liveBalances.size === 0) return accounts;
  return accounts.map((account) => {
    if (account.type !== 'spark') return account;
    const live = liveBalances.get(account.id);
    if (!live || live.equals(account.balance ?? Money.zero(account.currency))) {
      return account;
    }
    return { ...account, balance: live };
  });
}

/**
 * Hook to get the user's accounts, sorted by creation date (oldest first).
 *
 * Note: this hook does not fetch expired accounts from the database — the
 * store is initially populated by `getAllActive`. Expired accounts only enter
 * the store when (a) realtime ACCOUNT_UPDATED transitions an account from
 * active to expired during the session, or (b) {@link useAccountOrNull} lazy-fetches
 * a specific one. Passing `state: 'expired'` (or `['active', 'expired']`)
 * returns only those expired accounts already in the store, not the user's full
 * expired history.
 *
 * @param select - Optional filters. See {@link UseAccountsSelect}.
 *   Including `purpose: 'gift-card' | 'offer'` narrows the return type to
 *   `ExtendedAccount<'cashu'>[]`.
 * @returns The filtered accounts.
 */
export function useAccounts(
  select: UseAccountsSelect<'cashu', 'gift-card'>,
): ExtendedAccount<'cashu'>[];
export function useAccounts(
  select: UseAccountsSelect<'cashu', 'offer'>,
): ExtendedAccount<'cashu'>[];
export function useAccounts<
  T extends AccountType = AccountType,
  P extends AccountPurpose = AccountPurpose,
>(select?: UseAccountsSelect<T, P>): ExtendedAccount<T>[];
export function useAccounts<
  T extends AccountType = AccountType,
  P extends AccountPurpose = AccountPurpose,
>(select?: UseAccountsSelect<T, P>): ExtendedAccount<T>[] {
  const accounts = useStoreSuspense(getSdk().accounts.all);
  const user = useStoreSuspense(getSdk().user.current);
  const liveSparkBalances = useLiveSparkBalances();

  const { currency, type, isOnline, purpose, state = 'active' } = select ?? {};

  return useMemo(() => {
    if (!user) {
      throw new Error('Cannot use useAccounts hook in anonymous context');
    }
    const allowedStates = Array.isArray(state) ? state : [state];
    const overlaid = overlayLiveSparkBalances(accounts, liveSparkBalances);
    const extendedData = AccountService.getExtendedAccounts(user, overlaid);

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
  }, [
    accounts,
    user,
    liveSparkBalances,
    currency,
    type,
    isOnline,
    purpose,
    state,
  ]);
}

/**
 * Hook to get an account by ID.
 * @param id - The ID of the account to retrieve.
 * @returns The specified account.
 * @throws Error if the account is not found.
 */
export function useAccount<T extends AccountType = AccountType>(id: string) {
  const accounts = useAccounts<T>();
  const account = accounts.find((x) => x.id === id);

  if (!account) {
    throw new Error(`Account with id ${id} not found`);
  }

  return account;
}

const ALL_ACCOUNT_STATES: AccountState[] = ['active', 'expired'];

/**
 * Hook to get an account by ID, or null if not found. Falls back to a DB lookup
 * when the account is not in the accounts store, so it returns expired accounts
 * too — needed for routes that may be loaded directly (e.g. tab reload,
 * post-payment redirect) for an offer the cron job has since flipped to
 * `state='expired'`.
 *
 * The primary value comes from the accounts store; on a store miss the
 * `useSuspenseQuery` fetches the account from the DB (the residual
 * `accountRepository`). Its stored value is always null — it's only a
 * fetch + suspension primitive — so the fetched account is returned directly
 * rather than threaded back through the store.
 * @param id - The ID of the account to retrieve.
 */
export function useAccountOrNull(id: string | null): Account | null {
  const accountRepository = useAccountRepository();
  const accounts = useAccounts({ state: ALL_ACCOUNT_STATES });
  const accountFromStore = id
    ? (accounts.find((x) => x.id === id) ?? null)
    : null;

  const { data: fetchedAccount } = useSuspenseQuery({
    queryKey: ['fetch-account-by-id', id],
    queryFn: async () => {
      if (!id || accountFromStore) return null;
      return (await accountRepository.get(id)) ?? null;
    },
    // The query holds the lazily-fetched expired account only; once it is in the
    // store (or the route unmounts) there's no reason to keep it around.
    gcTime: 0,
  });

  return accountFromStore ?? fetchedAccount;
}

type AccountTypeMap = {
  cashu: CashuAccount;
  spark: SparkAccount;
};

/**
 * Hook to get the method which returns the account from the store or throws an error if not found.
 * @param type - The type of the account to get. If provided the type of the returned account will be narrowed.
 * @returns The method which returns the account or throws an error if the account is not found or if the account type does not match the provided type.
 */
export function useGetAccount<T extends keyof AccountTypeMap>(
  type: T,
): (id: string) => AccountTypeMap[T];
export function useGetAccount(type?: undefined): (id: string) => Account;
export function useGetAccount(type?: keyof AccountTypeMap) {
  return useCallback(
    (id: string) => {
      const account = getSdk()
        .accounts.all.get()
        ?.find((x) => x.id === id);
      if (!account) {
        throw new Error(`Account not found for id: ${id}`);
      }
      if (type && account.type !== type) {
        throw new Error(`Account with id: ${id} is not of type: ${type}`);
      }
      return account;
    },
    [type],
  );
}

/**
 * Hook to get the method which returns the cashu account from the store or throws an error if not found.
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
  return useCallback(
    (mintUrl: string, currency: Currency) =>
      getSdk()
        .accounts.all.get()
        ?.find(
          (a): a is CashuAccount =>
            a.type === 'cashu' &&
            a.mintUrl === mintUrl &&
            a.currency === currency,
        ) ?? null,
    [],
  );
}

/**
 * Hook to get the method which returns the spark account from the store or throws an error if not found.
 * @returns The method which returns the spark account or throws an error if the account is not found or if the account type is not spark.
 */
export function useGetSparkAccount() {
  return useGetAccount('spark');
}

export function useDefaultAccount() {
  const defaultCurrency = useUser((x) => x.defaultCurrency);
  const accounts = useAccounts({ currency: defaultCurrency });

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
  const accounts = useAccounts();
  const defaultAccount = useDefaultAccount();

  return accountId
    ? (accounts.find((a) => a.id === accountId) ?? defaultAccount)
    : defaultAccount;
}

export function useAddCashuAccount() {
  const { mutateAsync } = useMutation({
    mutationFn: (account: AddCashuAccountInput) =>
      getSdk().accounts.add(account),
  });

  return mutateAsync;
}

/**
 * Hook to get the sum of all transactional account balances for a given currency.
 * Null balances are ignored.
 */
export function useBalance(currency: Currency) {
  const accounts = useAccounts({
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
 *
 * Consumed only by the (soon-to-be-deleted) pending/unresolved background query
 * hooks; the online filter moves into the SDK work-sets. Kept as a thin
 * store-backed reader until those consumers are removed.
 */
export function useSelectItemsWithOnlineAccount() {
  return useCallback(<T extends { accountId: string }>(items: T[]): T[] => {
    const accounts = getSdk().accounts.all.get();
    return items.filter((item) => {
      const account = accounts?.find((x) => x.id === item.accountId);
      return account?.isOnline;
    });
  }, []);
}
