import type { SdkEvent } from '@agicash/breez-sdk-spark';
import type { AgicashDb } from '@agicash/db-types';
import { Money } from '@agicash/utils/money';
import type { QueryClient } from '@tanstack/query-core';
import { seedQueryOptions } from '../cashu';
import type { Encryption } from '../encryption';
import { sparkMnemonicQueryOptions } from '../spark';
import { sparkDebugLog } from '../spark-config';
import type { Account, CashuAccount, SparkAccount } from './account';
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
  add: (
    account: Parameters<AccountService['addCashuAccount']>[0]['account'],
  ) => Promise<CashuAccount>;
  /**
   * Registers Breez event listeners on the given spark accounts and records
   * balance changes in the accounts state. The host binds this to its
   * reactive accounts list lifecycle.
   * @returns a cleanup function removing the listeners.
   */
  trackSparkBalances: (accounts: SparkAccount[]) => () => void;
  /**
   * Transitional escape hatch — NOT part of the public surface. Only for (a)
   * not-yet-migrated SDK collaborators still composed in web feature code
   * (receive/send repositories and services) and (b) the web-owned
   * realtime + spark-balance infrastructure until the SDK owns realtime.
   * App/UI code must use the curated methods above. Shrinks each phase and is
   * removed once the remaining domains and the realtime hub move into the SDK.
   */
  internal: {
    repository: AccountRepository;
    service: AccountService;
    cache: AccountsCache;
  };
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
    trackSparkBalances: (sparkAccounts) => {
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
    },
    internal: {
      repository,
      service,
      cache,
    },
  };

  return {
    api,
    repository,
    service,
    cache,
    changeHandlers: createAccountChangeHandlers(repository, cache),
  };
}
