import { type Currency, Money } from '@agicash/lib';
import { useSdk } from '@agicash/react-wallet-sdk';
import { useQ } from '@agicash/react-wallet-sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import { useUser } from '../user/user-hooks';
import type {
  Account,
  AccountPurpose,
  AccountState,
  AccountType,
  CashuAccount,
  ExtendedAccount,
  SparkAccount,
} from './account';
import { useAccountService } from './account-service';

// ---- useAccounts ----

/**
 * Filter options for `useAccounts` hook.
 * Results are sorted by creation date (oldest first).
 */
type UseAccountsSelect<
  T extends AccountType = AccountType,
  P extends AccountPurpose = AccountPurpose,
> = P extends 'gift-card' | 'offer'
  ? {
      currency?: Currency;
      type?: 'cashu';
      isOnline?: boolean;
      purpose: P;
      state?: AccountState | AccountState[];
    }
  : {
      currency?: Currency;
      type?: T;
      isOnline?: boolean;
      purpose?: P;
      state?: AccountState | AccountState[];
    };

/**
 * Hook to get the user's accounts, sorted by creation date (oldest first).
 *
 * Returns the filtered array directly (suspends while loading).
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
  const sdk = useSdk();
  const data = useQ(sdk.accounts.list());

  const { currency, type, isOnline, purpose, state = 'active' } = select ?? {};

  return useMemo(() => {
    const allowedStates = Array.isArray(state) ? state : [state];
    return data.filter((account) => {
      if (!allowedStates.includes(account.state)) return false;
      if (currency && account.currency !== currency) return false;
      if (type && account.type !== type) return false;
      if (isOnline !== undefined && account.isOnline !== isOnline) return false;
      if (purpose && account.purpose !== purpose) return false;
      return true;
    }) as unknown as ExtendedAccount<T>[];
  }, [data, currency, type, isOnline, purpose, state]);
}

// ---- useAccount ----

/**
 * Hook to get an account by ID.
 * @throws Error if the account is not found.
 */
export function useAccount<T extends AccountType = AccountType>(
  id: string,
): ExtendedAccount<T> {
  const accounts = useAccounts<T>();
  const account = accounts.find((x) => x.id === id);

  if (!account) {
    throw new Error(`Account with id ${id} not found`);
  }

  return account;
}

// ---- useAccountOrNull ----

/**
 * Hook to get an account by ID or null.
 * Uses the SDK's `accounts.get(id)` which also fetches expired accounts from the DB.
 */
export function useAccountOrNull(id: string | null): Account | null {
  const sdk = useSdk();
  // Always call useQ to maintain hook call order — for a null id we still need
  // a stable Query<T> to subscribe to.  `accounts.get('')` returns null quickly.
  const found = useQ(sdk.accounts.get(id ?? ''));
  if (!id) return null;
  return found as unknown as Account | null;
}

// ---- useGetAccount / useGetCashuAccount / useGetSparkAccount ----

type AccountTypeMap = {
  cashu: CashuAccount;
  spark: SparkAccount;
};

/**
 * Hook to get a function that retrieves an account from the cached list by id.
 */
export function useGetAccount<T extends keyof AccountTypeMap>(
  type: T,
): (id: string) => AccountTypeMap[T];
export function useGetAccount(type?: undefined): (id: string) => Account;
export function useGetAccount(type?: keyof AccountTypeMap) {
  const accounts = useAccounts();

  return useCallback(
    (id: string) => {
      const account = accounts.find((x) => x.id === id) as Account | undefined;
      if (!account) {
        throw new Error(`Account not found for id: ${id}`);
      }
      if (type && account.type !== type) {
        throw new Error(`Account with id: ${id} is not of type: ${type}`);
      }
      return account;
    },
    [accounts, type],
  );
}

/**
 * Hook to get a function that retrieves the cashu account by id.
 */
export function useGetCashuAccount() {
  return useGetAccount('cashu');
}

/**
 * Hook to get a function that retrieves the spark account by id.
 */
export function useGetSparkAccount() {
  return useGetAccount('spark');
}

/**
 * Hook to get a function that finds a cashu account matching a mint URL and currency.
 */
export function useGetCashuAccountByMintUrlAndCurrency() {
  const accounts = useAccounts();

  return useCallback(
    (mintUrl: string, currency: Currency) =>
      (accounts as Account[]).find(
        (a): a is CashuAccount =>
          a.type === 'cashu' &&
          a.mintUrl === mintUrl &&
          a.currency === currency,
      ) ?? null,
    [accounts],
  );
}

// ---- useDefaultAccount ----

export function useDefaultAccount() {
  const sdk = useSdk();
  const sdkDefaultAccount = useQ(sdk.accounts.getDefault());
  const defaultAccount = sdkDefaultAccount as unknown as ExtendedAccount | null;
  const accounts = useAccounts();
  const defaultCurrency = useUser((x) => x.defaultCurrency);

  // Fallback ref: if the default flips to null briefly while a new default account
  // is propagating, keep the previous selection rather than crashing.
  const previousDefaultAccountIdRef = useRef(defaultAccount?.id);

  if (!defaultAccount) {
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

  previousDefaultAccountIdRef.current = defaultAccount.id;
  return defaultAccount;
}

// ---- useAccountOrDefault ----

/**
 * Hook to get an account by ID or fall back to the default account.
 */
export function useAccountOrDefault(accountId: string | null) {
  const accounts = useAccounts();
  const defaultAccount = useDefaultAccount();

  return accountId
    ? (accounts.find((a) => a.id === accountId) ?? defaultAccount)
    : defaultAccount;
}

// ---- useAddCashuAccount ----

export function useAddCashuAccount() {
  const userId = useUser((x) => x.id);
  const sdk = useSdk();
  const queryClient = useQueryClient();
  const accountService = useAccountService(queryClient);

  const { mutateAsync } = useMutation({
    mutationFn: async (
      account: Parameters<typeof accountService.addCashuAccount>[0]['account'],
    ) => accountService.addCashuAccount({ userId, account }),
    onSuccess: () => {
      // Refresh the SDK list so reactive subscribers see the new account.
      void sdk.accounts.list().refetch();
    },
  });

  return mutateAsync;
}

// ---- useBalance ----

/**
 * Hook to get the sum of all transactional account balances for a given currency.
 * Null balances are ignored.
 */
export function useBalance(currency: Currency) {
  const sdk = useSdk();
  const accounts = useAccounts({
    currency,
    purpose: 'transactional',
  });
  return useMemo(
    () =>
      accounts.reduce((acc, account) => {
        // biome-ignore lint/suspicious/noExplicitAny: web Account and SDK Account are structurally equivalent at runtime
        const accountBalance = sdk.accounts.getBalance(account as any);
        return acc.add(accountBalance);
      }, Money.zero(currency)),
    [sdk, accounts, currency],
  );
}

// ---- useSelectItemsWithOnlineAccount ----

/**
 * Hook that returns a selector function to filter out items with offline accounts.
 */
export function useSelectItemsWithOnlineAccount() {
  const accounts = useAccounts();

  return useCallback(
    <T extends { accountId: string }>(items: T[]): T[] => {
      return items.filter((item) => {
        const account = accounts.find((a) => a.id === item.accountId);
        return account?.isOnline;
      });
    },
    [accounts],
  );
}
