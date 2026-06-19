import type { MintValidator } from '@agicash/cashu';
import {
  type StorageProvider,
  configure as configureOpenSecret,
} from '@agicash/opensecret';
import { type QueryClient, QueryObserver } from '@tanstack/query-core';
import { type AccountsApi, createAccountsApi } from './accounts/accounts-api';
import { configureAgicashDb, getAgicashDb } from './agicash-db';
import {
  type AuthApi,
  type AuthState,
  type ResolvedAuthState,
  createAuthApi,
} from './auth';
import { type ContactsApi, createContactsApi } from './contacts/contacts-api';
import { createLazyEncryption } from './encryption';
import { type CaptureException, setErrorReporter } from './error-reporting';
import { type FeatureFlagsApi, createFeatureFlagsApi } from './feature-flags';
import { type MeasureOperation, setOperationMeasurer } from './performance';
import { getQueryClient } from './query-client';
import { type RealtimeApi, createRealtimeApi } from './realtime/realtime-api';
import { type ReceiveApi, createReceiveApi } from './receive/receive-api';
import { type SendApi, createSendApi } from './send/send-api';
import { configureSpark, setSparkDebugLogging } from './spark-config';
import { TaskProcessingLockRepository } from './task-processing-lock-repository';
import { createCashuReceiveQuoteProcessor } from './tasks/cashu-receive-quote-processor';
import { createCashuReceiveSwapProcessor } from './tasks/cashu-receive-swap-processor';
import { createCashuSendQuoteProcessor } from './tasks/cashu-send-quote-processor';
import { createCashuSendSwapProcessor } from './tasks/cashu-send-swap-processor';
import { createSparkReceiveQuoteProcessor } from './tasks/spark-receive-quote-processor';
import { createSparkSendQuoteProcessor } from './tasks/spark-send-quote-processor';
import { type TasksApi, createTasksApi } from './tasks/tasks-api';
import {
  type TransactionsApi,
  createTransactionsApi,
} from './transactions/transactions-api';
import { type TransferApi, createTransferApi } from './transfer/transfer-api';
import { type UserApi, createUserApi } from './user/user-api';

// Re-exported so hosts configure storage without importing @agicash/opensecret
// directly — the SDK is their only boundary to the auth backend.
export { browserStorage } from '@agicash/opensecret';

export type { AccountsApi } from './accounts/accounts-api';
export type { AuthApi } from './auth';
export type { ContactsApi } from './contacts/contacts-api';
export type { FeatureFlagsApi } from './feature-flags';
export type { RealtimeApi } from './realtime/realtime-api';
export type { ReceiveApi } from './receive/receive-api';
export type { SendApi } from './send/send-api';
export type { TasksApi } from './tasks/tasks-api';
export type { TransactionsApi } from './transactions/transactions-api';
export type { TransferApi } from './transfer/transfer-api';
export type { UserApi } from './user/user-api';

export type WalletSdkConfig = {
  /** OpenSecret auth/enclave backend connection. */
  openSecret: {
    apiUrl: string;
    clientId: string;
    /**
     * Backs the auth tokens and session state. Host-provided so the SDK stays
     * platform-agnostic: the web passes OpenSecret's `browserStorage` helper
     * (window.localStorage/sessionStorage); a headless host (Node/MCP) passes
     * its own StorageProvider implementation.
     */
    storage: StorageProvider;
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
  /**
   * Host hook invoked with the token's user id before the auth user fetch
   * (lets the host associate observability with the user as early as
   * possible).
   */
  onAuthUserIdDecoded?: (userId: string | undefined) => void;
  /**
   * Host hook invoked when the auth state query resolves (the web app
   * mirrors the state into Sentry and its SSR session-hint cookie).
   */
  onAuthStateResolved?: (state: ResolvedAuthState) => void;
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
    storage: config.openSecret.storage,
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
  readonly auth: AuthApi;
  readonly featureFlags: FeatureFlagsApi;
  readonly accounts: AccountsApi;
  readonly user: UserApi;
  readonly transactions: TransactionsApi;
  readonly contacts: ContactsApi;
  readonly receive: ReceiveApi;
  readonly send: SendApi;
  readonly transfer: TransferApi;
  readonly realtime: RealtimeApi;
  readonly tasks: TasksApi;

  private static instance: WalletSdk | undefined;

  // Private so the SDK is constructed only through getInstance(): there can be
  // exactly one instance. The QueryClient, the Agicash DB client (and its RLS
  // session token), and the OpenSecret token store are process-global, so a
  // second instance would silently share one user's cache and session with
  // another — a cross-user leak. The SDK is single-user by design (RLS-scoped,
  // derives the current user from its own state), so one instance == one user.
  // Multi-instance (a multi-tenant headless host) becomes safe only once those
  // resources are instance-owned (constructor-injected); that lands in the MCP
  // phase, and this guard lifts together with it.
  private constructor(config: WalletSdkConfig) {
    this.queryClient = getQueryClient();
    const db = getAgicashDb();
    const encryption = createLazyEncryption(this.queryClient);

    const featureFlags = createFeatureFlagsApi({
      queryClient: this.queryClient,
      db,
    });
    this.featureFlags = featureFlags;
    // The Breez SDK's debug logging follows the DEBUG_LOGGING_SPARK flag; wired
    // here now that feature flags live in the SDK (was a web-side seam before).
    setSparkDebugLogging(() => featureFlags.get('DEBUG_LOGGING_SPARK'));

    this.auth = createAuthApi({
      queryClient: this.queryClient,
      onAuthUserIdDecoded: config.onAuthUserIdDecoded,
      onAuthStateResolved: config.onAuthStateResolved,
      // Re-evaluate the session-scoped feature flags whenever an auth mutation
      // changes the session (login / logout / verify / ...).
      onSessionChange: () => featureFlags.invalidate(),
    });
    const getCurrentUser = () => user.getCurrentUser();
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
      // The auth domain is the identity source: upsert derives the user's id
      // from the authenticated session.
      getAuthUserId: () => this.auth.getUserId(),
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

    const transfer = createTransferApi({
      getCurrentUserId,
      cashuReceiveQuoteService: receive.cashuReceiveQuoteService,
      sparkReceiveQuoteService: receive.sparkReceiveQuoteService,
      cashuSendQuoteService: send.cashuSendQuoteService,
      sparkSendQuoteService: send.sparkSendQuoteService,
    });
    this.transfer = transfer.api;

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
      // Observe the auth state so realtime (re)subscribes the right
      // wallet:{userId} channel as the session changes. The auth user id is the
      // wallet user id, and the channel's RLS is JWT-based, so this is valid
      // even before the user row is bootstrapped.
      subscribeToUserId: (listener) => {
        const observer = new QueryObserver<AuthState>(
          this.queryClient,
          this.auth.stateOptions(),
        );
        let lastUserId: string | null | undefined;
        const emit = (state: AuthState | undefined) => {
          const userId = state?.isLoggedIn ? state.user.id : null;
          if (userId === lastUserId) {
            return;
          }
          lastUserId = userId;
          listener(userId);
        };
        const stopObserving = observer.subscribe((result) => emit(result.data));
        emit(observer.getCurrentResult().data);
        return () => {
          stopObserving();
          observer.destroy();
        };
      },
    });

    this.tasks = createTasksApi({
      queryClient: this.queryClient,
      taskProcessingLockRepository: new TaskProcessingLockRepository(db),
      getCurrentUserId,
      processors: [
        createCashuSendQuoteProcessor({
          queryClient: this.queryClient,
          cashuSendQuoteService: send.cashuSendQuoteService,
          unresolvedCashuSendQuotesCache: send.unresolvedCashuSendQuotesCache,
          accountsCache: accounts.cache,
          unresolvedCashuQuotesOptions: send.api.unresolvedCashuQuotesOptions,
        }),
        createCashuReceiveQuoteProcessor({
          queryClient: this.queryClient,
          cashuReceiveQuoteService: receive.cashuReceiveQuoteService,
          cashuReceiveQuoteCache: receive.cashuReceiveQuoteCache,
          pendingCashuReceiveQuotesCache:
            receive.pendingCashuReceiveQuotesCache,
          accountsCache: accounts.cache,
          invalidateTransaction: transactions.api.invalidate,
          pendingCashuQuotesOptions: receive.api.pendingCashuQuotesOptions,
        }),
        createCashuReceiveSwapProcessor({
          queryClient: this.queryClient,
          cashuReceiveSwapService: receive.cashuReceiveSwapService,
          pendingCashuReceiveSwapsCache: receive.pendingCashuReceiveSwapsCache,
          accountsCache: accounts.cache,
          pendingCashuSwapsOptions: receive.api.pendingCashuSwapsOptions,
        }),
        createSparkReceiveQuoteProcessor({
          queryClient: this.queryClient,
          sparkReceiveQuoteService: receive.sparkReceiveQuoteService,
          sparkReceiveQuoteCache: receive.sparkReceiveQuoteCache,
          pendingSparkReceiveQuotesCache:
            receive.pendingSparkReceiveQuotesCache,
          accountsCache: accounts.cache,
          invalidateTransaction: transactions.api.invalidate,
          pendingSparkQuotesOptions: receive.api.pendingSparkQuotesOptions,
        }),
        createSparkSendQuoteProcessor({
          queryClient: this.queryClient,
          sparkSendQuoteService: send.sparkSendQuoteService,
          unresolvedSparkSendQuotesCache: send.unresolvedSparkSendQuotesCache,
          accountsCache: accounts.cache,
          unresolvedSparkQuotesOptions: send.api.unresolvedSparkQuotesOptions,
        }),
        createCashuSendSwapProcessor({
          queryClient: this.queryClient,
          cashuSendSwapService: send.cashuSendSwapService,
          cashuSendSwapCache: send.cashuSendSwapCache,
          accountsCache: accounts.cache,
          unresolvedCashuSwapsOptions: send.api.unresolvedCashuSwapsOptions,
        }),
      ],
    });
  }

  /**
   * Starts the background engines that keep the SDK's cache correct — the
   * realtime wallet channel, the leader-elected task processor, and spark
   * balance tracking — and returns a function that stops them all. The host
   * calls this once after a session is established (e.g. when the authenticated
   * app mounts, or a daemon boots after login), so it can't forget to turn on a
   * cog the cache depends on.
   *
   * Could instead be invoked from the constructor to auto-start (zero host
   * ceremony). Deferred for now: tasks and spark balance read the current user
   * eagerly, so they would first need the session-gating realtime already has
   * before they're safe to start before login.
   */
  start(): () => void {
    this.tasks.start();
    const stopRealtime = this.realtime.start();
    const stopSparkBalanceTracking = this.accounts.startSparkBalanceTracking();
    return () => {
      this.tasks.stop();
      stopRealtime();
      stopSparkBalanceTracking();
    };
  }

  /**
   * The SDK's sole accessor: returns the configured singleton, constructing it
   * on first call. Idempotent — later calls return the same instance and never
   * build another (see the constructor for why exactly one is the limit). Hosts
   * wrap this (the web's `getSdk`/`useSdk`); a headless host calls it directly.
   * Whether a given runtime may construct the SDK (browser vs. server) is host
   * policy, not the SDK's.
   *
   * @throws if called before {@link configureWalletSdk}.
   */
  static getInstance(): WalletSdk {
    if (!sdkConfig) {
      throw new Error(
        'Wallet SDK is not configured. Call configureWalletSdk first.',
      );
    }
    WalletSdk.instance ??= new WalletSdk(sdkConfig);
    return WalletSdk.instance;
  }
}
