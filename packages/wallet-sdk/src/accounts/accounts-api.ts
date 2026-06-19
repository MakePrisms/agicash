import type { SdkEvent } from '@agicash/breez-sdk-spark';
import type { AgicashDb } from '@agicash/db-types';
import { Money } from '@agicash/utils/money';
import { type QueryClient, QueryObserver } from '@tanstack/query-core';
import { seedQueryOptions } from '../cashu';
import type { Encryption } from '../encryption';
import { sparkMnemonicQueryOptions } from '../spark';
import { sparkDebugLog } from '../spark-config';
import type {
  Account,
  CashuAccount,
  NewCashuAccount,
  SparkAccount,
} from './account';
import { AccountRepository } from './account-repository';
import { AccountService } from './account-service';
import {
  AccountsCache,
  accountsQueryOptions,
  createAccountChangeHandlers,
} from './accounts-cache';

export type AccountsApi = {
  /**
   * Query config for the reactive accounts list of the current user (consume
   * with useSuspenseQuery). The id is resolved from the user state at fetch
   * time, so the queryFn rejects if no user is loaded yet.
   */
  listOptions: () => ReturnType<typeof accountsQueryOptions>;
  /**
   * Fetches an account from the DB (including expired ones the list query
   * doesn't return) and records it in the accounts state.
   * @returns the account, or null if not found.
   */
  get: (id: string) => Promise<Account | null>;
  /** The account from the in-memory accounts state, or null. */
  getCached: (id: string) => Account | null;
  /** Snapshot of the in-memory accounts state. */
  listCached: () => Account[];
  /**
   * Creates a cashu account for the current user and records it in the
   * accounts state.
   * @throws if no user is loaded yet.
   */
  add: (account: NewCashuAccount) => Promise<CashuAccount>;
};

export type AccountsApiDeps = {
  queryClient: QueryClient;
  db: AgicashDb;
  encryption: Encryption;
  sparkStorageDir: string;
  /**
   * Resolves the current user's id from the SDK's user state. A thunk because
   * the accounts domain is constructed before the user domain; it is only
   * invoked at query/call time, after the bootstrap upsert.
   * @throws if no user is loaded yet.
   */
  getCurrentUserId: () => string;
};

/**
 * Builds the accounts domain. Returns the repository and cache alongside the
 * api because other domain factories wire against the same instances (the
 * user domain's WriteUserRepository and its upsert accounts write-back).
 */
export function createAccountsApi(deps: AccountsApiDeps): {
  api: AccountsApi;
  repository: AccountRepository;
  service: AccountService;
  cache: AccountsCache;
  changeHandlers: ReturnType<typeof createAccountChangeHandlers>;
  /**
   * The always-on Spark balance tracker's start fn. Returned alongside `api`
   * (not on it) so the SDK root can wire it into sdk.start() as the single
   * entry point; see its definition for behavior.
   */
  startSparkBalanceTracking: () => () => void;
} {
  const { queryClient, db, encryption, sparkStorageDir, getCurrentUserId } =
    deps;

  const repository = new AccountRepository({
    db,
    encryption,
    queryClient,
    getCashuWalletSeed: () => queryClient.fetchQuery(seedQueryOptions()),
    getSparkWalletMnemonic: () =>
      queryClient.fetchQuery(sparkMnemonicQueryOptions()),
    sparkStorageDir,
  });
  const service = new AccountService({
    accountRepository: repository,
    queryClient,
  });
  const cache = new AccountsCache(queryClient);

  const trackSparkBalances = (sparkAccounts: SparkAccount[]): (() => void) => {
    const registrations = sparkAccounts.map((account) => {
      const listenerPromise = account.wallet.addEventListener({
        onEvent(event: SdkEvent) {
          sparkDebugLog('Breez event', {
            accountId: account.id,
            type: event.type,
          });

          if (
            event.type === 'paymentSucceeded' ||
            event.type === 'paymentPending' ||
            event.type === 'paymentFailed' ||
            event.type === 'claimedDeposits' ||
            event.type === 'synced'
          ) {
            account.wallet.getInfo({}).then((info) => {
              const balance = new Money({
                amount: info.balanceSats,
                currency: 'BTC',
                unit: 'sat',
              }) as Money;
              cache.updateSparkAccountBalance({
                accountId: account.id,
                balance,
              });
            });
          }
        },
      });
      return { wallet: account.wallet, listenerPromise };
    });

    return () => {
      for (const { wallet, listenerPromise } of registrations) {
        listenerPromise
          .then((id) => wallet.removeEventListener(id))
          .catch(() => {
            console.warn('Failed to remove Spark event listener');
          });
      }
    };
  };

  // Mirrors the web's useAccounts({ type: 'spark', isOnline: true }) (active by
  // default): the spark accounts whose balances are live-tracked.
  const selectTrackableSparkAccounts = (accounts: Account[]): SparkAccount[] =>
    accounts.filter(
      (account): account is SparkAccount =>
        account.type === 'spark' &&
        account.isOnline &&
        account.state === 'active',
    );

  /**
   * Starts the always-on Spark balance tracker: observes the current user's
   * online, active spark accounts and registers Breez event listeners that
   * record balance changes in the accounts state, re-tracking as that set
   * changes. Returns a stop function. Client-only (observes the query cache).
   */
  const startSparkBalanceTracking = (): (() => void) => {
    let stopTracking: (() => void) | null = null;
    let lastAccounts: SparkAccount[] | undefined;

    const reconcile = (accounts: SparkAccount[]) => {
      // query-core structural sharing keeps the selected reference stable
      // across unrelated changes, so gate on it: re-track only when the set
      // actually changes.
      if (accounts === lastAccounts) {
        return;
      }
      lastAccounts = accounts;
      stopTracking?.();
      stopTracking = trackSparkBalances(accounts);
    };

    const observer = new QueryObserver<Account[], Error, SparkAccount[]>(
      queryClient,
      {
        ...accountsQueryOptions({
          getUserId: getCurrentUserId,
          accountRepository: repository,
        }),
        refetchOnWindowFocus: 'always',
        refetchOnReconnect: 'always',
        select: selectTrackableSparkAccounts,
      },
    );

    const unsubscribe = observer.subscribe((result) => {
      reconcile(result.data ?? []);
    });
    reconcile(observer.getCurrentResult().data ?? []);

    return () => {
      unsubscribe();
      observer.destroy();
      stopTracking?.();
      stopTracking = null;
      lastAccounts = undefined;
    };
  };

  const api: AccountsApi = {
    listOptions: () =>
      accountsQueryOptions({
        getUserId: getCurrentUserId,
        accountRepository: repository,
      }),
    get: async (id: string) => {
      const account = await repository.get(id);
      if (account) {
        cache.upsert(account);
      }
      return account;
    },
    getCached: (id: string) => cache.get(id),
    listCached: () => cache.getAll() ?? [],
    add: async (account) => {
      const created = await service.addCashuAccount({
        userId: getCurrentUserId(),
        account,
      });
      // Recorded immediately so reads right after creation see the account
      // without waiting for the realtime broadcast.
      cache.upsert(created);
      return created;
    },
  };

  return {
    api,
    repository,
    service,
    cache,
    changeHandlers: createAccountChangeHandlers(repository, cache),
    // Returned alongside `api` (not on it): the SDK root wires this into
    // sdk.start() so the tracker is driven through that single entry point and a
    // host can't start a duplicate by reaching for it directly.
    startSparkBalanceTracking,
  };
}
