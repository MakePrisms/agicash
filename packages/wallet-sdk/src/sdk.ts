import { configure as configureOpenSecret } from '@agicash/opensecret';
import { type QueryClient, isServer } from '@tanstack/query-core';
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

export class WalletSdk {
  readonly queryClient: QueryClient;
  readonly accounts: {
    repository: AccountRepository;
    service: AccountService;
    cache: AccountsCache;
    listOptions: (userId: string) => ReturnType<typeof accountsQueryOptions>;
    changeHandlers: ReturnType<typeof createAccountChangeHandlers>;
  };

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
    const cache = new AccountsCache(this.queryClient);

    this.accounts = {
      repository,
      service: new AccountService({
        accountRepository: repository,
        queryClient: this.queryClient,
      }),
      cache,
      listOptions: (userId: string) =>
        accountsQueryOptions({ userId, accountRepository: repository }),
      changeHandlers: createAccountChangeHandlers(repository, cache),
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
