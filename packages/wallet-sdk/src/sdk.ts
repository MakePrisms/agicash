import { jwtDecode } from 'jwt-decode';
import type { SdkConfig } from './config';
import { AuthDomain } from './domains/auth';
import { BackgroundDomain } from './domains/background';
import { UserDomain } from './domains/user';
import type { SdkCoreEventMap } from './events';
import type { CreateEngine } from './engine';
import { ProcessorRegistry } from './internal/background/processor-registry';
import { TaskProcessingLockRepository } from './internal/background/task-processing-lock-repository';
import { CashuReceiveQuoteProcessor } from './internal/background/processors/cashu-receive-quote-processor';
import { CashuReceiveSwapProcessor } from './internal/background/processors/cashu-receive-swap-processor';
import { CashuSendQuoteProcessor } from './internal/background/processors/cashu-send-quote-processor';
import { CashuSendSwapProcessor } from './internal/background/processors/cashu-send-swap-processor';
import { SparkReceiveQuoteProcessor } from './internal/background/processors/spark-receive-quote-processor';
import { SparkSendQuoteProcessor } from './internal/background/processors/spark-send-quote-processor';
import { ChangeFeed } from './internal/realtime/change-feed';
import { createRealtimeManager } from './internal/realtime/realtime-client';
import { createAgicashDb } from './internal/db/client';
import { SessionTokenProvider } from './internal/db/session-token';
import {
  ReadUserRepository,
  WriteUserRepository,
} from './internal/db/user-repository';
import { EventBus } from './internal/event-bus';
import { KeyService } from './internal/keys';
import { type OpenSecret, realOpenSecret } from './internal/opensecret';
import { createOpenSecretStorage } from './internal/opensecret-storage';
import {
  type WalletRuntime,
  createWalletRuntime,
} from './internal/wallet-runtime';

const REFRESH_TOKEN_KEY = 'refresh_token';

/** Internal handle for Plan 3b to reach the wallet runtime without exposing it on
 * the public Sdk surface. Importable only by SDK-internal code that knows the
 * symbol; not re-exported from the package barrel. */
export const walletRuntimeKey: unique symbol = Symbol('agicash.walletRuntime');

/**
 * Entry point. `Sdk.create(config)` configures Open Secret (with a StorageProvider
 * bridged to the host's async StorageAdapter), constructs the Supabase client +
 * session-token provider, and wires the auth domain. React-free; usable headless.
 */
export class Sdk {
  readonly auth: AuthDomain;
  readonly user: UserDomain;
  readonly background?: BackgroundDomain;
  private readonly events: EventBus<SdkCoreEventMap>;
  private readonly keys: KeyService;
  private readonly sessionToken: SessionTokenProvider;

  /** Internal: Plan 3b reaches the wallet runtime via this symbol. Not public. */
  readonly [walletRuntimeKey]: WalletRuntime;

  private constructor(parts: {
    auth: AuthDomain;
    user: UserDomain;
    events: EventBus<SdkCoreEventMap>;
    keys: KeyService;
    sessionToken: SessionTokenProvider;
    walletRuntime: WalletRuntime;
    background?: BackgroundDomain;
  }) {
    this.auth = parts.auth;
    this.user = parts.user;
    this.events = parts.events;
    this.keys = parts.keys;
    this.sessionToken = parts.sessionToken;
    this[walletRuntimeKey] = parts.walletRuntime;
    this.background = parts.background;
  }

  static async create(
    config: SdkConfig,
    // Test seam: inject a fake Open Secret port. Production uses realOpenSecret.
    deps: { openSecret?: OpenSecret; createEngine?: CreateEngine } = {},
  ): Promise<Sdk> {
    const os = deps.openSecret ?? realOpenSecret;
    const events = new EventBus<SdkCoreEventMap>();
    const storage = createOpenSecretStorage(
      config.storage,
      config.sessionStorage,
    );

    os.configure({
      apiUrl: config.openSecret.url,
      clientId: config.openSecret.clientId,
      storage,
    });

    const keys = new KeyService(os);

    const isLoggedIn = async (): Promise<boolean> => {
      const refresh = await config.storage.get(REFRESH_TOKEN_KEY);
      if (!refresh) return false;
      try {
        const { exp } = jwtDecode<{ exp?: number }>(refresh);
        return !!exp && exp * 1000 > Date.now();
      } catch {
        return false;
      }
    };

    const sessionToken = new SessionTokenProvider(os, isLoggedIn);
    const db = createAgicashDb(config.supabase, sessionToken.getToken);
    const walletRuntime = createWalletRuntime({
      db,
      keys,
      os,
      isLoggedIn,
      breezApiKey: config.breezApiKey ?? '',
      sparkStorageDir: config.sparkStorageDir ?? './.spark-data',
      domain: config.domain ?? '',
    });
    const writeUserRepo = new WriteUserRepository(db);
    const readUserRepo = new ReadUserRepository(db);
    const getCurrentUserId = async (): Promise<string | null> => {
      if (!(await isLoggedIn())) return null;
      try {
        const { user } = await os.fetchUser();
        return user.id;
      } catch {
        return null;
      }
    };

    const auth = new AuthDomain({
      os,
      keys,
      events,
      storage: config.storage,
      writeUserRepo,
      sessionToken,
      storageSession: storage,
      network: 'MAINNET',
      includeTestAccounts: config.includeTestAccounts ?? false,
    });

    const user = new UserDomain({
      readUserRepo,
      writeUserRepo,
      getCurrentUserId,
    });

    // Re-arm the session-expiry timer if a session is already present.
    await auth.initialize();

    let background: BackgroundDomain | undefined;
    if (deps.createEngine) {
      const engine = deps.createEngine({ events, runtime: walletRuntime, config });
      const p = walletRuntime.protocols;
      const registry = new ProcessorRegistry({
        cashuSendQuote: new CashuSendQuoteProcessor({
          service: p.cashuSendQuoteService,
          runner: engine.runner,
          wallets: engine.wallets,
          fetchWorkSet: (userId) => engine.workSets.getUnresolvedCashuSendQuotes(userId),
        }),
        cashuSendSwap: new CashuSendSwapProcessor({
          service: p.cashuSendSwapService,
          runner: engine.runner,
          wallets: engine.wallets,
          fetchWorkSet: (userId) => engine.workSets.getUnresolvedCashuSendSwaps(userId),
        }),
        sparkSendQuote: new SparkSendQuoteProcessor({
          service: p.sparkSendQuoteService,
          runner: engine.runner,
          wallets: engine.wallets,
          fetchWorkSet: (userId) => engine.workSets.getUnresolvedSparkSendQuotes(userId),
        }),
        cashuReceiveQuote: new CashuReceiveQuoteProcessor({
          service: p.cashuReceiveQuoteService,
          runner: engine.runner,
          wallets: engine.wallets,
          fetchWorkSet: (userId) => engine.workSets.getPendingCashuReceiveQuotes(userId),
        }),
        cashuReceiveSwap: new CashuReceiveSwapProcessor({
          service: p.cashuReceiveSwapService,
          runner: engine.runner,
          wallets: engine.wallets,
          fetchWorkSet: (userId) => engine.workSets.getPendingCashuReceiveSwaps(userId),
        }),
        sparkReceiveQuote: new SparkReceiveQuoteProcessor({
          service: p.sparkReceiveQuoteService,
          runner: engine.runner,
          wallets: engine.wallets,
          fetchWorkSet: (userId) => engine.workSets.getPendingSparkReceiveQuotes(userId),
        }),
      });
      const manager = createRealtimeManager(db);
      const changeFeed = new ChangeFeed({
        manager,
        events,
        routerDeps: {
          accountRepository: walletRuntime.accountRepository,
          transactionRepository: p.transactionRepository,
          cashuSendQuoteRepository: p.cashuSendQuoteRepository,
          cashuSendSwapRepository: p.cashuSendSwapRepository,
          cashuReceiveQuoteRepository: p.cashuReceiveQuoteRepository,
          cashuReceiveSwapRepository: p.cashuReceiveSwapRepository,
          sparkSendQuoteRepository: p.sparkSendQuoteRepository,
          sparkReceiveQuoteRepository: p.sparkReceiveQuoteRepository,
          domain: config.domain ?? '',
        },
        fanout: engine.fanout,
        trigger: registry,
      });
      background = new BackgroundDomain({
        lockRepo: new TaskProcessingLockRepository(db),
        changeFeed,
        registry,
        manager,
        events,
        getUserId: getCurrentUserId,
        clientId: config.clientId ?? crypto.randomUUID(),
      });
    }

    return new Sdk({ auth, user, events, keys, sessionToken, walletRuntime, background });
  }

  /** Subscribe to a core event. Returns an unsubscribe function. */
  on<E extends keyof SdkCoreEventMap>(
    event: E,
    cb: (payload: SdkCoreEventMap[E]) => void,
  ): () => void {
    return this.events.on(event, cb);
  }

  /** Coarse, idempotent catch-up hint. Re-verifies subscriptions + reloads work sets via the change-feed (no-op until background is started / no engine). */
  async resync(): Promise<void> {
    this.background?.resync();
  }

  /** Close down: disconnect spark wallets + clear wallet caches, stop the expiry
   * timer, drop all secret material, clear listeners. The runtime is torn down
   * before keys.clear() so wallet teardown still has any key material it needs. */
  async dispose(): Promise<void> {
    await this.background?.stop();
    this.auth.cancelSessionExpiry();
    await this[walletRuntimeKey].dispose();
    this.keys.clear();
    this.sessionToken.clear();
    this.events.clear();
  }
}
