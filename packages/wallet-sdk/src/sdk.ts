import { configure as configureOpenSecret } from '@agicash/opensecret';
import { type QueryClient, isServer } from '@tanstack/query-core';
import type { Account, CashuAccount } from './accounts/account';
import { AccountRepository } from './accounts/account-repository';
import { AccountService } from './accounts/account-service';
import {
  AccountsCache,
  accountsQueryOptions,
  createAccountChangeHandlers,
} from './accounts/accounts-cache';
import { configureAgicashDb, getAgicashDb } from './agicash-db';
import { seedQueryOptions } from './cashu';
import {
  type Encryption,
  encryptionPrivateKeyQueryOptions,
  encryptionPublicKeyQueryOptions,
  getEncryption,
} from './encryption';
import { type MeasureOperation, setOperationMeasurer } from './performance';
import { getQueryClient } from './query-client';
import { sparkMnemonicQueryOptions } from './spark';
import { configureSpark } from './spark-config';
import type { UpdateUser, User } from './user/user';
import {
  UserCache,
  createUserChangeHandlers,
  userQueryOptions,
} from './user/user-cache';
import {
  ReadUserRepository,
  WriteUserRepository,
} from './user/user-repository';
import { UserService } from './user/user-service';

export type WalletSdkConfig = {
  /** OpenSecret auth/enclave backend connection. */
  openSecret: {
    apiUrl: string;
    clientId: string;
  };
  /** Supabase connection (RLS-scoped via the OpenSecret session token). */
  supabase: {
    url: string;
    anonKey: string;
  };
  /** Spark/Breez connection. */
  breez: {
    apiKey: string;
  };
  /** Storage directory for the Breez SDK (browser: a virtual path). */
  sparkStorageDir: string;
  /**
   * Host instrumentation for the SDK's internal operation measurements
   * (the web app passes its Sentry-backed implementation).
   */
  measureOperation?: MeasureOperation;
};

let sdkConfig: WalletSdkConfig | undefined;

/**
 * Configures the SDK's connections. The host app calls this once at startup
 * (module load) with its env-derived values. Safe on both server and client —
 * it only records configuration; clients/wallets are constructed lazily.
 */
export function configureWalletSdk(config: WalletSdkConfig): void {
  sdkConfig = config;
  configureOpenSecret({
    apiUrl: config.openSecret.apiUrl,
    clientId: config.openSecret.clientId,
  });
  configureAgicashDb(config.supabase);
  configureSpark({ apiKey: config.breez.apiKey });
  if (config.measureOperation) {
    setOperationMeasurer(config.measureOperation);
  }
}

/**
 * An Encryption whose keys are resolved lazily through the SDK's key
 * queryOptions (staleTime Infinity — one fetch, then cached). This lets the
 * Sdk root construct domains before login/key-availability; the first
 * encrypt/decrypt awaits the keys.
 */
export function createLazyEncryption(queryClient: QueryClient): Encryption {
  const resolve = async () => {
    const [privateKey, publicKeyHex] = await Promise.all([
      queryClient.fetchQuery(encryptionPrivateKeyQueryOptions()),
      queryClient.fetchQuery(encryptionPublicKeyQueryOptions()),
    ]);
    return getEncryption(privateKey, publicKeyHex);
  };

  return {
    encrypt: async (data) => (await resolve()).encrypt(data),
    decrypt: async (data) => (await resolve()).decrypt(data),
    encryptBatch: async (data) => (await resolve()).encryptBatch(data),
    decryptBatch: async (data) => (await resolve()).decryptBatch(data),
  };
}

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
   * (user/receive/send repositories and services) and (b) the web-owned
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

export class WalletSdk {
  readonly queryClient: QueryClient;
  readonly accounts: AccountsApi;
  readonly user: UserApi;

  constructor(config: WalletSdkConfig) {
    this.queryClient = getQueryClient();

    const repository = new AccountRepository({
      db: getAgicashDb(),
      encryption: createLazyEncryption(this.queryClient),
      queryClient: this.queryClient,
      getCashuWalletSeed: () => this.queryClient.fetchQuery(seedQueryOptions()),
      getSparkWalletMnemonic: () =>
        this.queryClient.fetchQuery(sparkMnemonicQueryOptions()),
      sparkStorageDir: config.sparkStorageDir,
    });
    const service = new AccountService({
      accountRepository: repository,
      queryClient: this.queryClient,
    });
    const cache = new AccountsCache(this.queryClient);

    const readUserRepository = new ReadUserRepository(getAgicashDb());
    const writeUserRepository = new WriteUserRepository(
      getAgicashDb(),
      repository,
    );
    const userService = new UserService(writeUserRepository);
    const userCache = new UserCache(this.queryClient);

    this.user = {
      queryOptions: (userId: string) =>
        userQueryOptions({ userId, userRepository: readUserRepository }),
      getCached: () => userCache.get() ?? null,
      upsert: async (params, options) => {
        const result = await writeUserRepository.upsert(params, options);
        userCache.set(result.user);
        cache.set(result.accounts);
        return result;
      },
      update: async (userId, data, options) => {
        const updated = await writeUserRepository.update(userId, data, options);
        userCache.set(updated);
        return updated;
      },
      setDefaultAccount: async (user, account, options) => {
        const updated = await userService.setDefaultAccount(
          user,
          account,
          options,
        );
        userCache.set(updated);
        return updated;
      },
      internal: {
        readRepository: readUserRepository,
        writeRepository: writeUserRepository,
        service: userService,
        cache: userCache,
        changeHandlers: createUserChangeHandlers(userCache),
      },
    };

    this.accounts = {
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
  }
}

let sdkSingleton: WalletSdk | undefined;

/**
 * The SDK instance (client-only browser singleton — it wraps the browser
 * QueryClient and per-user connections; server code uses the per-request
 * primitives directly).
 *
 * @throws if called on the server or before {@link configureWalletSdk}.
 */
export function getSdk(): WalletSdk {
  if (isServer) {
    throw new Error('getSdk is client-only');
  }
  if (!sdkConfig) {
    throw new Error(
      'Wallet SDK is not configured. Call configureWalletSdk first.',
    );
  }
  if (!sdkSingleton) {
    sdkSingleton = new WalletSdk(sdkConfig);
  }
  return sdkSingleton;
}
