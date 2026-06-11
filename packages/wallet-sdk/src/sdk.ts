import { configure as configureOpenSecret } from '@agicash/opensecret';
import { type QueryClient, isServer } from '@tanstack/query-core';
import { type AccountsApi, createAccountsApi } from './accounts/accounts-api';
import { configureAgicashDb, getAgicashDb } from './agicash-db';
import { type ContactsApi, createContactsApi } from './contacts/contacts-api';
import { createLazyEncryption } from './encryption';
import { type MeasureOperation, setOperationMeasurer } from './performance';
import { getQueryClient } from './query-client';
import { configureSpark } from './spark-config';
import {
  type TransactionsApi,
  createTransactionsApi,
} from './transactions/transactions-api';
import { type UserApi, createUserApi } from './user/user-api';

export type { AccountsApi } from './accounts/accounts-api';
export type { ContactsApi } from './contacts/contacts-api';
export type { TransactionsApi } from './transactions/transactions-api';
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
   * Resolves the domain used to build lightning addresses (lud16) for the
   * current session. A thunk because the config is recorded on the server
   * too, where the host environment is not available; it is only invoked
   * client-side after getSdk().
   */
  getLightningAddressDomain: () => string;
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
  readonly transactions: TransactionsApi;
  readonly contacts: ContactsApi;

  constructor(config: WalletSdkConfig) {
    this.queryClient = getQueryClient();
    const db = getAgicashDb();
    const encryption = createLazyEncryption(this.queryClient);
    // Closes over this.user (assigned below) — safe because it is only
    // invoked at query/call time, after the bootstrap upsert.
    const getCurrentUserId = () => {
      const user = this.user.getCached();
      if (!user) {
        throw new Error('No user is loaded. Bootstrap the session first.');
      }
      return user.id;
    };

    const accounts = createAccountsApi({
      queryClient: this.queryClient,
      db,
      encryption,
      sparkStorageDir: config.sparkStorageDir,
      getCurrentUserId,
    });
    this.accounts = accounts.api;

    this.user = createUserApi({
      queryClient: this.queryClient,
      db,
      accountRepository: accounts.repository,
      accountsCache: accounts.cache,
    });

    this.transactions = createTransactionsApi({
      queryClient: this.queryClient,
      db,
      encryption,
      getCurrentUserId,
    });

    this.contacts = createContactsApi({
      queryClient: this.queryClient,
      db,
      getCurrentUserId,
      getDomain: config.getLightningAddressDomain,
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
