import type { AgicashDb } from '@agicash/db-types';
import type { QueryClient } from '@tanstack/query-core';
import type { Account } from '../accounts/account';
import type { AccountRepository } from '../accounts/account-repository';
import type { AccountsCache } from '../accounts/accounts-cache';
import type { UpdateUser, User } from './user';
import {
  UserCache,
  createUserChangeHandlers,
  userQueryOptions,
} from './user-cache';
import { ReadUserRepository, WriteUserRepository } from './user-repository';
import { UserService } from './user-service';

export type UserApi = {
  /**
   * Query config for the reactive current user (consume with
   * useSuspenseQuery). The id is resolved from the user state at fetch time,
   * so the queryFn rejects if no user is loaded yet.
   */
  queryOptions: () => ReturnType<typeof userQueryOptions>;
  /** The user from the in-memory user state, or null if not loaded yet. */
  getCached: () => User | null;
  /**
   * Creates the user (with their initial accounts) or updates an existing one,
   * then records both the user and the accounts in the in-memory state. This
   * is the identity injection point: the id comes from the host's auth layer,
   * and every other method operates on the user it established.
   */
  upsert: (
    params: Parameters<WriteUserRepository['upsert']>[0],
    options?: Parameters<WriteUserRepository['upsert']>[1],
  ) => Promise<{ user: User; accounts: Account[] }>;
  /**
   * Updates fields of the current user and records the result in the user
   * state.
   * @returns the updated user.
   * @throws if no user is loaded yet.
   */
  update: (
    data: UpdateUser,
    options?: Parameters<WriteUserRepository['update']>[2],
  ) => Promise<User>;
  /**
   * Sets the account as the current user's default for its currency
   * (optionally also the default currency) and records the result in the
   * user state.
   * @returns the updated user.
   * @throws if no user is loaded yet.
   */
  setDefaultAccount: (
    account: Account,
    options?: Parameters<UserService['setDefaultAccount']>[2],
  ) => Promise<User>;
  /**
   * Transitional escape hatch — NOT part of the public surface. Only for (a)
   * not-yet-migrated SDK collaborators still composed in web feature code
   * (the receive/send services) and (b) the web-owned realtime infrastructure
   * until the SDK owns the realtime hub. App/UI code must use the curated
   * methods above. Shrinks each phase and is removed once the remaining
   * domains and the realtime hub move into the SDK.
   */
  internal: {
    readRepository: ReadUserRepository;
    writeRepository: WriteUserRepository;
    service: UserService;
    cache: UserCache;
    changeHandlers: ReturnType<typeof createUserChangeHandlers>;
  };
};

export type UserApiDeps = {
  queryClient: QueryClient;
  db: AgicashDb;
  /** Accounts-domain instances shared with the accounts api: upsert maps the
   * created db accounts through the repository and records them in the
   * accounts state. */
  accountRepository: AccountRepository;
  accountsCache: AccountsCache;
};

export function createUserApi(deps: UserApiDeps): {
  api: UserApi;
  service: UserService;
} {
  const { queryClient, db, accountRepository, accountsCache } = deps;

  const readRepository = new ReadUserRepository(db);
  const writeRepository = new WriteUserRepository(db, accountRepository);
  const service = new UserService(writeRepository);
  const cache = new UserCache(queryClient);

  const getCurrentUser = (): User => {
    const user = cache.get();
    if (!user) {
      throw new Error('No user is loaded. Bootstrap the session first.');
    }
    return user;
  };

  const api: UserApi = {
    queryOptions: () =>
      userQueryOptions({
        getUserId: () => getCurrentUser().id,
        userRepository: readRepository,
      }),
    getCached: () => cache.get() ?? null,
    upsert: async (params, options) => {
      const result = await writeRepository.upsert(params, options);
      cache.set(result.user);
      accountsCache.set(result.accounts);
      return result;
    },
    update: async (data, options) => {
      const updated = await writeRepository.update(
        getCurrentUser().id,
        data,
        options,
      );
      cache.set(updated);
      return updated;
    },
    setDefaultAccount: async (account, options) => {
      const updated = await service.setDefaultAccount(
        getCurrentUser(),
        account,
        options,
      );
      cache.set(updated);
      return updated;
    },
    internal: {
      readRepository,
      writeRepository,
      service,
      cache,
      changeHandlers: createUserChangeHandlers(cache),
    },
  };

  return { api, service };
}
