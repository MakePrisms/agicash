import { configure as configureOpenSecret } from '@agicash/opensecret';
import { type QueryClient, isServer } from '@tanstack/query-core';
import { type AccountsApi, createAccountsApi } from './accounts/accounts-api';
import { configureAgicashDb, getAgicashDb } from './agicash-db';
import { createLazyEncryption } from './encryption';
import { type MeasureOperation, setOperationMeasurer } from './performance';
import { getQueryClient } from './query-client';
import { configureSpark } from './spark-config';
import { type UserApi, createUserApi } from './user/user-api';

export type { AccountsApi } from './accounts/accounts-api';
export type { UserApi } from './user/user-api';

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

export class WalletSdk {
  readonly queryClient: QueryClient;
  readonly accounts: AccountsApi;
  readonly user: UserApi;

  constructor(config: WalletSdkConfig) {
    this.queryClient = getQueryClient();
    const db = getAgicashDb();

    const accounts = createAccountsApi({
      queryClient: this.queryClient,
      db,
      encryption: createLazyEncryption(this.queryClient),
      sparkStorageDir: config.sparkStorageDir,
    });
    this.accounts = accounts.api;

    this.user = createUserApi({
      queryClient: this.queryClient,
      db,
      accountRepository: accounts.repository,
      accountsCache: accounts.cache,
    });
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
