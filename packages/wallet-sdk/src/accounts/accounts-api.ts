import type { AgicashDb } from '@agicash/db-types';
import type { QueryClient } from '@tanstack/query-core';
import { seedQueryOptions } from '../cashu';
import type { Encryption } from '../encryption';
import { sparkMnemonicQueryOptions } from '../spark';
import type { Account, CashuAccount } from './account';
import { AccountRepository } from './account-repository';
import { AccountService } from './account-service';
import {
  AccountsCache,
  accountsQueryOptions,
  createAccountChangeHandlers,
} from './accounts-cache';

export type AccountsApi = {
  /** Query config for the reactive accounts list (consume with useSuspenseQuery). */
  listOptions: (userId: string) => ReturnType<typeof accountsQueryOptions>;
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
  /** Creates a cashu account and records it in the accounts state. */
  add: (
    params: Parameters<AccountService['addCashuAccount']>[0],
  ) => Promise<CashuAccount>;
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
    changeHandlers: ReturnType<typeof createAccountChangeHandlers>;
  };
};

export type AccountsApiDeps = {
  queryClient: QueryClient;
  db: AgicashDb;
  encryption: Encryption;
  sparkStorageDir: string;
};

/**
 * Builds the accounts domain. Returns the repository and cache alongside the
 * api because other domain factories wire against the same instances (the
 * user domain's WriteUserRepository and its upsert accounts write-back).
 */
export function createAccountsApi(deps: AccountsApiDeps): {
  api: AccountsApi;
  repository: AccountRepository;
  cache: AccountsCache;
} {
  const { queryClient, db, encryption, sparkStorageDir } = deps;

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
    listOptions: (userId: string) =>
      accountsQueryOptions({ userId, accountRepository: repository }),
    get: async (id: string) => {
      const account = await repository.get(id);
      if (account) {
        cache.upsert(account);
      }
      return account;
    },
    getCached: (id: string) => cache.get(id),
    listCached: () => cache.getAll() ?? [],
    add: async (params) => {
      const account = await service.addCashuAccount(params);
      // Recorded immediately so reads right after creation see the account
      // without waiting for the realtime broadcast.
      cache.upsert(account);
      return account;
    },
    internal: {
      repository,
      service,
      cache,
      changeHandlers: createAccountChangeHandlers(repository, cache),
    },
  };

  return { api, repository, cache };
}
