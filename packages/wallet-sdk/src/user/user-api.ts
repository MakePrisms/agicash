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
  /** Query config for the reactive current user (consume with useSuspenseQuery). */
  queryOptions: (userId: string) => ReturnType<typeof userQueryOptions>;
  /** The user from the in-memory user state, or null if not loaded yet. */
  getCached: () => User | null;
  /**
   * Creates the user (with their initial accounts) or updates an existing one,
   * then records both the user and the accounts in the in-memory state.
   */
  upsert: (
    params: Parameters<WriteUserRepository['upsert']>[0],
    options?: Parameters<WriteUserRepository['upsert']>[1],
  ) => Promise<{ user: User; accounts: Account[] }>;
  /**
   * Updates user fields and records the result in the user state.
   * @returns the updated user.
   */
  update: (
    userId: string,
    data: UpdateUser,
    options?: Parameters<WriteUserRepository['update']>[2],
  ) => Promise<User>;
  /**
   * Sets the account as the user's default for its currency (optionally also
   * the default currency) and records the result in the user state.
   * @returns the updated user.
   */
  setDefaultAccount: (
    user: User,
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

export function createUserApi(deps: UserApiDeps): UserApi {
  const { queryClient, db, accountRepository, accountsCache } = deps;

  const readRepository = new ReadUserRepository(db);
  const writeRepository = new WriteUserRepository(db, accountRepository);
  const service = new UserService(writeRepository);
  const cache = new UserCache(queryClient);

  return {
    queryOptions: (userId: string) =>
      userQueryOptions({ userId, userRepository: readRepository }),
    getCached: () => cache.get() ?? null,
    upsert: async (params, options) => {
      const result = await writeRepository.upsert(params, options);
      cache.set(result.user);
      accountsCache.set(result.accounts);
      return result;
    },
    update: async (userId, data, options) => {
      const updated = await writeRepository.update(userId, data, options);
      cache.set(updated);
      return updated;
    },
    setDefaultAccount: async (user, account, options) => {
      const updated = await service.setDefaultAccount(user, account, options);
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
}
