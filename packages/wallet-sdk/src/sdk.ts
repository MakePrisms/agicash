import type { MintValidator } from '@agicash/cashu';
import { configure as configureOpenSecret } from '@agicash/opensecret';
import { type QueryClient, isServer } from '@tanstack/query-core';
import { type AccountsApi, createAccountsApi } from './accounts/accounts-api';
import { configureAgicashDb, getAgicashDb } from './agicash-db';
import { type ContactsApi, createContactsApi } from './contacts/contacts-api';
import { createLazyEncryption } from './encryption';
import { type CaptureException, setErrorReporter } from './error-reporting';
import { type MeasureOperation, setOperationMeasurer } from './performance';
import { getQueryClient } from './query-client';
import { type RealtimeApi, createRealtimeApi } from './realtime/realtime-api';
import { type ReceiveApi, createReceiveApi } from './receive/receive-api';
import { type SendApi, createSendApi } from './send/send-api';
import { configureSpark } from './spark-config';
import {
  type TransactionsApi,
  createTransactionsApi,
} from './transactions/transactions-api';
import { type UserApi, createUserApi } from './user/user-api';

export type { AccountsApi } from './accounts/accounts-api';
export type { ContactsApi } from './contacts/contacts-api';
export type { RealtimeApi } from './realtime/realtime-api';
export type { ReceiveApi } from './receive/receive-api';
export type { SendApi } from './send/send-api';
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
   * The mint validation policy applied when the receive flow builds an
   * account for an unknown mint. Host-provided because the blocklist is
   * derived from the host's environment.
   */
  cashuMintValidator: MintValidator;
  /**
   * Host instrumentation for the SDK's internal operation measurements
   * (the web app passes its Sentry-backed implementation).
   */
  measureOperation?: MeasureOperation;
  /**
   * Host error reporting for failures the SDK handles itself but the host
   * wants to observe (the web app passes Sentry's captureException).
   */
  captureException?: CaptureException;
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
  if (config.captureException) {
    setErrorReporter(config.captureException);
  }
}

export class WalletSdk {
  readonly queryClient: QueryClient;
  readonly accounts: AccountsApi;
  readonly user: UserApi;
  readonly transactions: TransactionsApi;
  readonly contacts: ContactsApi;
  readonly receive: ReceiveApi;
  readonly send: SendApi;
  readonly realtime: RealtimeApi;

  constructor(config: WalletSdkConfig) {
    this.queryClient = getQueryClient();
    const db = getAgicashDb();
    const encryption = createLazyEncryption(this.queryClient);
    // Close over this.user (assigned below) — safe because they are only
    // invoked at query/call time, after the bootstrap upsert.
    const getCurrentUser = () => {
      const user = this.user.getCached();
      if (!user) {
        throw new Error('No user is loaded. Bootstrap the session first.');
      }
      return user;
    };
    const getCurrentUserId = () => getCurrentUser().id;

    const accounts = createAccountsApi({
      queryClient: this.queryClient,
      db,
      encryption,
      sparkStorageDir: config.sparkStorageDir,
      getCurrentUserId,
    });
    this.accounts = accounts.api;

    const user = createUserApi({
      queryClient: this.queryClient,
      db,
      accountRepository: accounts.repository,
      accountsCache: accounts.cache,
    });
    this.user = user.api;

    const transactions = createTransactionsApi({
      queryClient: this.queryClient,
      db,
      encryption,
      getCurrentUserId,
    });
    this.transactions = transactions.api;

    const contacts = createContactsApi({
      queryClient: this.queryClient,
      db,
      getCurrentUserId,
      getDomain: config.getLightningAddressDomain,
    });
    this.contacts = contacts.api;

    const receive = createReceiveApi({
      queryClient: this.queryClient,
      db,
      encryption,
      getCurrentUserId,
      getCurrentUser,
      accountRepository: accounts.repository,
      accountService: accounts.service,
      userService: user.service,
      cashuMintValidator: config.cashuMintValidator,
    });
    this.receive = receive.api;

    const send = createSendApi({
      queryClient: this.queryClient,
      db,
      encryption,
      getCurrentUserId,
      accountsCache: accounts.cache,
      cashuReceiveSwapService: receive.cashuReceiveSwapService,
    });
    this.send = send.api;

    const invalidateOnReconnect = [
      accounts.cache,
      transactions.cache,
      ...receive.caches,
      ...send.caches,
      contacts.cache,
      user.cache,
    ];
    this.realtime = createRealtimeApi({
      realtimeClient: db.realtime,
      getCurrentUserId,
      changeHandlers: [
        ...accounts.changeHandlers,
        ...transactions.changeHandlers,
        ...receive.changeHandlers,
        ...send.changeHandlers,
        ...contacts.changeHandlers,
        ...user.changeHandlers,
      ],
      // Refetches the domain state on connect/reconnect to catch up on
      // updates missed while the realtime connection was down.
      onConnected: () => {
        for (const cache of invalidateOnReconnect) {
          cache.invalidate();
        }
      },
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
