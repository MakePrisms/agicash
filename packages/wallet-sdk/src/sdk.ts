/**
 * The `Sdk` class — §1 of the contract. The CORE shell + connection wiring (Slice 0).
 *
 * PR2 turns PR1's `declare class` into a real implementation: `Sdk.create` validates
 * the config, instantiates the connections (OpenSecret client, the SDK-owned Supabase
 * client wired to an internal access-token provider, the storage adapter), constructs
 * the typed event emitter, and wires each domain accessor to a STUB whose methods throw
 * (`NotImplementedError`) until its slice lands. `destroy()` tears the instance down.
 *
 * What is REAL here: config validation; the OpenSecret/Supabase/storage wiring; the
 * event emitter; the lifecycle shell. What is STUBBED: all domain business logic (auth,
 * accounts, scan, cashu, spark, transactions, contacts, transfers, exchangeRate,
 * background) — see `./internal/stub-domains` and each slice in the build plan.
 *
 * Session RESUME is automatic: the OpenSecret client rehydrates its persisted session on
 * init (see `./internal/open-secret`), and the Supabase access-token provider lazily
 * fetches a fresh JWT on first DB read.
 */
import type { SdkConfig } from './config';
import type {
  AccountsDomain,
  AuthDomain,
  BackgroundDomain,
  CashuDomain,
  ContactsDomain,
  ExchangeRateDomain,
  ScanDomain,
  SparkDomain,
  TransactionsDomain,
  TransfersDomain,
  UserDomain,
} from './domains';
import type { EventEmitter, SdkEventMap } from './events';
import { AccountsDomainImpl } from './domains/accounts';
import { AuthDomainImpl } from './domains/auth';
import {
  CashuDomainImpl,
  CashuReceiveOpsImpl,
  CashuSendOpsImpl,
} from './domains/cashu';
import { ScanDomainImpl } from './domains/scan';
import { UserDomainImpl } from './domains/user';
import { LiveAccountHandleResolver } from './internal/account-handle-resolver';
import { AccountRepository } from './internal/account-repository';
import { CashuReceiveQuoteRepository } from './internal/cashu-receive-quote-repository';
import { CashuReceiveQuoteService } from './internal/cashu-receive-quote-service';
import { CashuReceiveSwapRepository } from './internal/cashu-receive-swap-repository';
import { CashuReceiveSwapService } from './internal/cashu-receive-swap-service';
import { CashuSendQuoteRepository } from './internal/cashu-send-quote-repository';
import { CashuSendQuoteService } from './internal/cashu-send-quote-service';
import { CashuSendSwapRepository } from './internal/cashu-send-swap-repository';
import { CashuSendSwapService } from './internal/cashu-send-swap-service';
import { MintMetadataCache } from './internal/cashu-wallet';
import { ClaimCashuTokenFlow } from './internal/claim-cashu-token-flow';
import { dbAccountToAccount } from './internal/db-account';
import { createEncryption } from './internal/encryption';
import { Orchestrator } from './internal/orchestrator';
import { ReceiveCashuTokenQuoteService } from './internal/receive-cashu-token-quote-service';
import { SparkBalanceTracker } from './internal/spark-balance-tracker';
import { SparkReceiveQuoteRepository } from './internal/spark-receive-quote-repository';
import { SparkReceiveQuoteService } from './internal/spark-receive-quote-service';
import { SparkSendQuoteRepository } from './internal/spark-send-quote-repository';
import { SparkSendQuoteService } from './internal/spark-send-quote-service';
import { SparkWalletCache } from './internal/spark-wallet';
import {
  SparkDomainImpl,
  SparkReceiveOpsImpl,
  SparkSendOpsImpl,
} from './domains/spark';
import { TypedEventEmitter } from './internal/event-emitter';
import { GuestAccountStorage } from './internal/guest-account-storage';
import { OpenSecretClient } from './internal/open-secret';
import { SessionResolver } from './internal/session';
import {
  createBackgroundStub,
  createContactsStub,
  createExchangeRateStub,
  createTransactionsStub,
  createTransfersStub,
} from './internal/stub-domains';
import {
  type SupabaseConnectionConfig,
  type WalletSupabaseClient,
  createSupabaseClient,
} from './internal/supabase-client';
import { SupabaseSessionTokenProvider } from './internal/supabase-session';
import { UserRepository } from './internal/user-repository';
import type { AgicashDbAccountWithProofs } from './internal/db-account';
import type { CashuAccount } from './types/account';
import type { StorageAdapter } from './types/dependencies';

/**
 * The SDK-internal connection bundle assembled by {@link Sdk.create} and handed to the
 * domain implementations (real ones, in later slices) so they share one Supabase client,
 * one OpenSecret client, one token provider, and one storage adapter.
 *
 * Not exported from the package barrel — it is the wiring substrate, not public API.
 */
export type SdkConnections = {
  readonly supabase: WalletSupabaseClient;
  readonly openSecret: OpenSecretClient;
  readonly sessionToken: SupabaseSessionTokenProvider;
  readonly storage: StorageAdapter;
  readonly events: TypedEventEmitter<SdkEventMap>;
  /** leader-election instance id (provided or auto-generated). */
  readonly clientId: string;
  /** Per-mint protocol-metadata memo (held so `destroy()` can drop it). */
  readonly mintCache: MintMetadataCache;
  /** Per-(mnemonic,network) connected-spark-wallet memo (held so `destroy()` can drop it). */
  readonly sparkCache: SparkWalletCache;
  /**
   * Spark balance source: Breez event listeners → `account:updated` (compare-before-emit). Held
   * so `destroy()` removes its listeners. PR5c builds it; the S5 background/realtime slice calls
   * `track(onlineSparkAccounts)` to start it.
   */
  readonly sparkBalanceTracker: SparkBalanceTracker;
  /**
   * The unified `executeQuote` ORCHESTRATOR (PR5d): the framework-free state machine the cashu +
   * spark send/receive domains drive. Held so `destroy()` tears down its live mint-WS subscriptions
   * + in-flight indices.
   */
  readonly orchestrator: Orchestrator;
};

/** Validate `config` (shape the rest of `create` relies on). Throws on a missing field. */
function validateConfig(config: SdkConfig): void {
  if (!config) {
    throw new Error('Sdk.create: config is required');
  }
  if (!config.openSecret?.url || !config.openSecret?.clientId) {
    throw new Error(
      'Sdk.create: config.openSecret.{url,clientId} are required',
    );
  }
  if (!config.supabase?.url || !config.supabase?.anonKey) {
    throw new Error('Sdk.create: config.supabase.{url,anonKey} are required');
  }
  if (!config.storage) {
    throw new Error('Sdk.create: config.storage (StorageAdapter) is required');
  }
}

/**
 * Generate a leader-election client id when the caller omits one. Uses
 * `crypto.randomUUID` (available in browsers + Node ≥ 19 / Bun — the SDK's targets;
 * matches master's `crypto.randomUUID()` clientId in `wallet/task-processing.ts`).
 */
function generateClientId(): string {
  return crypto.randomUUID();
}

/**
 * The Agicash wallet SDK — the single entry point a consumer (the web wallet or
 * the MCP wallet) interacts with. Construct it with {@link Sdk.create}, reach
 * functionality through the domain accessors, subscribe to {@link Sdk.events}
 * for reactivity, and call {@link Sdk.destroy} to tear it down.
 *
 * The SDK is framework-free and holds no general domain cache: methods return
 * Promises, long-running operations return a quote whose discriminated `state`
 * carries progress, and all change notifications flow through `events`.
 */
export class Sdk {
  /** Authentication: sign in/up/out, password + guest flows, OAuth. */
  readonly auth: AuthDomain;
  /** The current user and profile mutations (e.g. username). */
  readonly user: UserDomain;
  /** Wallet accounts: list/get, defaults, add, balance, suggestions. */
  readonly accounts: AccountsDomain;
  /** Cashu operations — `.send` + `.receive`. */
  readonly cashu: CashuDomain;
  /** Spark operations — `.send` + `.receive`. */
  readonly spark: SparkDomain;
  /** Transaction history: paginated list, get, acknowledgement. */
  readonly transactions: TransactionsDomain;
  /** Saved contacts: list/get/add/remove + user search. */
  readonly contacts: ContactsDomain;
  /** Cross-account transfers (cashu↔spark via Lightning). */
  readonly transfers: TransfersDomain;
  /** Parse a scanned/pasted destination string. */
  readonly scan: ScanDomain;
  /** Fiat/BTC exchange-rate conversion. */
  readonly exchangeRate: ExchangeRateDomain;
  /** Background processing lifecycle (leader-elected orchestrators). */
  readonly background: BackgroundDomain;
  /**
   * Type-safe event subscription surface — the SDK's only reactivity channel.
   * Public surface is `on` / `once` (the emitter's `emit` / `off` are internal).
   */
  readonly events: EventEmitter<SdkEventMap>;

  /** The shared connection bundle (internal; domains read it in later slices). */
  private readonly connections: SdkConnections;

  /**
   * Private — construct via {@link Sdk.create}. Takes the assembled connection bundle plus
   * the already-built real domains (`auth` + `user` as of Slice 1; `accounts` + `scan` as of
   * Slice 2) and wires the domain accessors. Domains not yet implemented are wired to a stub;
   * later slices replace each stub here with its real implementation.
   *
   * @param connections - the shared connection bundle.
   * @param domains - the real domain implementations built in {@link Sdk.create}.
   */
  private constructor(
    connections: SdkConnections,
    domains: {
      auth: AuthDomain;
      user: UserDomain;
      accounts: AccountsDomain;
      scan: ScanDomain;
      cashu: CashuDomain;
      spark: SparkDomain;
    },
  ) {
    this.connections = connections;
    this.events = connections.events;

    // --- real domains --------------------------------------------------------
    // Slice 1: auth + user.
    this.auth = domains.auth;
    this.user = domains.user;
    // Slice 2: accounts + scan.
    this.accounts = domains.accounts;
    this.scan = domains.scan;
    // Slice 3 / PR5b: cashu send + receive ops (executeQuote orchestrator deferred to PR5d).
    this.cashu = domains.cashu;
    // Slice 3 / PR5c: spark send + receive ops (executeQuote orchestrator deferred to PR5d).
    this.spark = domains.spark;

    // --- domain accessors still STUBBED (swap per slice) ---------------------
    this.transactions = createTransactionsStub();
    this.contacts = createContactsStub();
    this.transfers = createTransfersStub();
    this.exchangeRate = createExchangeRateStub();
    this.background = createBackgroundStub();
  }

  /**
   * Create + initialise an SDK instance.
   *
   * Validates `config`, configures the OpenSecret client (which rehydrates any persisted
   * session → session resume), builds the SDK-owned Supabase client wired to the internal
   * access-token provider (the OpenSecret JWT, RLS-scoped), threads the storage adapter,
   * and constructs the event emitter. Returns a ready `Sdk` whose domains are stubbed
   * until their slices land.
   *
   * @param config - see {@link SdkConfig}.
   * @returns the initialised SDK.
   * @throws Error if a required config field is missing.
   */
  static async create(config: SdkConfig): Promise<Sdk> {
    validateConfig(config);

    // OpenSecret: module-global configure + session rehydration; holds the storage adapter.
    const openSecret = new OpenSecretClient(config.openSecret, config.storage);

    // Access-token provider: the Supabase `accessToken` callback. Audience = the Supabase
    // project URL (so the mint-CAT audience stays separate, per master's two-audience use).
    // Short-circuit to `null` when signed out (master `supabase-session.ts` gates on
    // `isLoggedIn()`) so unauthenticated DB reads don't trigger a failing enclave call.
    const sessionToken = new SupabaseSessionTokenProvider(async () => {
      if (!(await openSecret.hasSession())) {
        return null;
      }
      return openSecret.generateThirdPartyToken(config.supabase.url);
    });

    // Supabase: SDK-owned client (schema 'wallet', RLS via the token provider).
    const supabaseConfig: SupabaseConnectionConfig = {
      url: config.supabase.url,
      anonKey: config.supabase.anonKey,
      serviceRoleKey: config.supabase.serviceRoleKey,
    };
    const supabase = createSupabaseClient(
      supabaseConfig,
      sessionToken.getToken,
    );

    const events = new TypedEventEmitter<SdkEventMap>();

    // Live-handle memos (the cashu per-mint protocol metadata + the spark per-wallet
    // connection). Held on the connection bundle so `destroy()` can drop them.
    const mintCache = new MintMetadataCache();
    const sparkCache = new SparkWalletCache();
    // Spark balance source (Breez listeners → `account:updated`). Built here, started by S5.
    const sparkBalanceTracker = new SparkBalanceTracker(events);
    const clientId = config.clientId ?? generateClientId();

    // --- Slice 1: auth + user domains ----------------------------------------
    // The agicash domain `User` is the `wallet.users` row keyed by the OpenSecret user id,
    // so both domains share a session resolver (enclave id → DB row + `auth:*` events) over
    // one user repository.
    const users = new UserRepository(supabase);
    const session = new SessionResolver(
      openSecret,
      users,
      sessionToken,
      events,
    );
    const guestStorage = new GuestAccountStorage(config.storage);
    const auth = new AuthDomainImpl(openSecret, session, guestStorage);
    const user = new UserDomainImpl(session, users);

    // --- Slice 2: accounts + scan domains ------------------------------------
    // The account repository reads/writes the `wallet.accounts` table and maps rows to the
    // domain `Account`. An account's LIVE wallet handle + decrypted cashu proofs / spark
    // balance are filled in by the handle resolver — the REAL one (Slice 3): it initialises
    // the cashu mint wallet (1 h-memo'd keyset/keys fetch + 10 s timeout), decrypts the
    // proofs (OpenSecret-derived key + ECIES), and connects the spark Breez wallet (when a
    // `breezApiKey` is configured). The per-mint + per-spark memos (built above, on the
    // connection bundle) live as long as the SDK and are dropped in `destroy()`.
    const encryption = createEncryption(
      () => openSecret.getEncryptionPrivateKeyHex(),
      () => openSecret.getEncryptionPublicKeyHex(),
    );
    const accountHandleResolver = new LiveAccountHandleResolver({
      encryption,
      getCashuWalletSeed: () => openSecret.getCashuWalletSeed(),
      mintCache,
      getSparkWalletMnemonic: () => openSecret.getSparkWalletMnemonic(),
      sparkCache,
      breezApiKey: config.breezApiKey,
      // Master's `account-repository` default; the Breez SDK persists per-wallet state here.
      sparkStorageDir: './.spark-data',
    });
    const accountRepository = new AccountRepository(
      supabase,
      accountHandleResolver,
    );
    const accounts = new AccountsDomainImpl(accountRepository, users, session);
    // Scan is connection-free (pure decode). `allowLocalhost` defaults to false (production);
    // master gates it on `import.meta.env.MODE === 'development'`, which the framework-free
    // SDK does not read.
    const scan = new ScanDomainImpl();

    // --- Slice 3 / PR5b: cashu send + receive ops ----------------------------
    // The cashu repos write/read the `wallet.cashu_{send,receive}_*` tables over the SDK-owned
    // Supabase client + the SDK Encryption (encrypt-on-write / decrypt-on-read of the jsonb +
    // proof ciphertext). The account-returning RPCs (receive payment/complete) map the returned
    // row via the resolver-backed `dbAccountToAccount` (the same live-handle resolver Slice 2
    // wires). The services drive the mint over each account's live `ExtendedCashuWallet` (PR5a),
    // keeping master's idempotency (`wallet.restore`) + DB reservation / CONCURRENCY_ERROR
    // guards. `executeQuote` (the orchestrator state machine) is DEFERRED to PR5d — see
    // `domains/cashu.ts`; PR5b ships the primitives it sequences.
    const mapCashuAccount = (row: AgicashDbAccountWithProofs) =>
      dbAccountToAccount<CashuAccount>(row, accountHandleResolver);

    const cashuSendQuoteRepository = new CashuSendQuoteRepository(
      supabase,
      encryption,
    );
    const cashuSendSwapRepository = new CashuSendSwapRepository(
      supabase,
      encryption,
    );
    const cashuReceiveQuoteRepository = new CashuReceiveQuoteRepository(
      supabase,
      encryption,
      mapCashuAccount,
    );
    const cashuReceiveSwapRepository = new CashuReceiveSwapRepository(
      supabase,
      encryption,
      mapCashuAccount,
    );

    const cashuReceiveSwapService = new CashuReceiveSwapService(
      cashuReceiveSwapRepository,
    );
    const cashuSendQuoteService = new CashuSendQuoteService(
      cashuSendQuoteRepository,
    );
    const cashuSendSwapService = new CashuSendSwapService(
      cashuSendSwapRepository,
      cashuReceiveSwapService,
    );
    // The cashu crypto operations (NUT-20 quote-locking xPub + unlocking key) are backed by the
    // OpenSecret client (re-housed off master's `useCashuCryptography` query options).
    const cashuReceiveQuoteService = new CashuReceiveQuoteService(
      {
        getXpub: (path?: string) => openSecret.getCashuLockingXpub(path),
        getPrivateKey: (path?: string) =>
          openSecret.getCashuLockingPrivateKeyHex(path),
      },
      cashuReceiveQuoteRepository,
    );

    // --- Slice 3 / PR5c: spark send + receive ops ----------------------------
    // The spark repos write/read the `wallet.spark_{send,receive}_quotes` tables over the
    // SDK-owned Supabase client + the SDK Encryption (encrypt-on-write / decrypt-on-read of the
    // jsonb). The services drive each account's live `BreezSdk` handle (PR5a) for the protocol
    // work: `prepareSendPayment`/`sendPayment` (send — idempotent via `idempotencyKey: quote.id`)
    // and `receivePayment` (the receive invoice). Spark balance is sourced from Breez's OWN event
    // listener (`sparkBalanceTracker`, started by S5), NOT a DB trigger. `executeQuote` (the
    // orchestrator state machine) is DEFERRED to PR5d — see `domains/spark.ts`; PR5c ships the
    // primitives it sequences.
    const sparkSendQuoteRepository = new SparkSendQuoteRepository(
      supabase,
      encryption,
    );
    const sparkReceiveQuoteRepository = new SparkReceiveQuoteRepository(
      supabase,
      encryption,
    );
    const sparkSendQuoteService = new SparkSendQuoteService(
      sparkSendQuoteRepository,
    );
    const sparkReceiveQuoteService = new SparkReceiveQuoteService(
      sparkReceiveQuoteRepository,
    );

    // --- Slice 3 / PR5d: the executeQuote ORCHESTRATOR -----------------------
    // The framework-free state machine (build plan's single biggest net-new construct) that
    // absorbs master's six React-resident `useProcess*Tasks` hooks. It DRIVES the idempotent
    // PR5b/5c service primitives off FRESH DB reads (no cache) + the mint melt/mint-quote WS
    // subscriptions, and emits the `send:*` / `receive:*` events. Shared by both protocols' send
    // (`executeQuote`) + receive (kickoff/completion) domains so a kickoff and the (future,
    // Slice-5) leader-gated processor act on one source of truth.
    const orchestrator = new Orchestrator({
      accounts: accountRepository,
      events,
      cashuSendQuoteService,
      cashuSendQuoteRepository,
      cashuSendSwapService,
      cashuSendSwapRepository,
      cashuReceiveQuoteService,
      cashuReceiveQuoteRepository,
      cashuReceiveSwapService,
      cashuReceiveSwapRepository,
      sparkSendQuoteService,
      sparkSendQuoteRepository,
      sparkReceiveQuoteService,
      sparkReceiveQuoteRepository,
    });

    // The cross-account cashu-token receive quote builder + the token-claim flow behind
    // `cashu.receive.receiveToken` (decode → resolve source/destination → same-mint swap OR
    // cross-account melt-then-mint, all driven by the orchestrator).
    const receiveCashuTokenQuoteService = new ReceiveCashuTokenQuoteService(
      cashuReceiveQuoteService,
      sparkReceiveQuoteService,
    );
    const claimCashuTokenFlow = new ClaimCashuTokenFlow({
      accounts: accountRepository,
      cashuReceiveSwapService,
      receiveCashuTokenQuoteService,
      orchestrator,
      mintCache,
    });

    const cashu = new CashuDomainImpl(
      new CashuSendOpsImpl(
        cashuSendQuoteService,
        cashuSendSwapService,
        cashuSendQuoteRepository,
        cashuSendSwapRepository,
        accountRepository,
        session,
        orchestrator,
      ),
      new CashuReceiveOpsImpl(
        cashuReceiveQuoteService,
        cashuReceiveQuoteRepository,
        session,
        claimCashuTokenFlow,
      ),
    );

    const spark = new SparkDomainImpl(
      new SparkSendOpsImpl(sparkSendQuoteService, session, orchestrator),
      new SparkReceiveOpsImpl(sparkReceiveQuoteService, session),
    );

    // The shared connection bundle (held by `Sdk` so `destroy()` can tear everything down). Built
    // last because the orchestrator (PR5d) needs every protocol service/repo constructed first.
    const connections: SdkConnections = {
      supabase,
      openSecret,
      sessionToken,
      storage: config.storage,
      events,
      clientId,
      mintCache,
      sparkCache,
      sparkBalanceTracker,
      orchestrator,
    };

    return new Sdk(connections, { auth, user, accounts, scan, cashu, spark });
  }

  /**
   * Tear down the instance: close WS subscriptions (mints + Supabase realtime + Breez),
   * halt the background orchestrators, and clear timers + subscribers. Call when the
   * consumer is done with the SDK.
   *
   * PR2 implements the parts that exist in the core shell: it stops Supabase realtime,
   * drops the cached session token, and clears all event subscribers. The mint-WS /
   * Breez / orchestrator / leader-election teardown is finalised in Slice 5 when those
   * connections are actually opened — this method is the single seam they hook.
   */
  async destroy(): Promise<void> {
    // Close Supabase realtime channels (no-op if none were opened yet).
    await this.connections.supabase.removeAllChannels();
    // Drop the cached access token.
    this.connections.sessionToken.clear();
    // Drop the live-handle memos (cashu mint metadata + connected spark wallets).
    this.connections.mintCache.clear();
    this.connections.sparkCache.clear();
    // Remove the spark Breez balance listeners (the `account:updated` source).
    this.connections.sparkBalanceTracker.stop();
    // Close the orchestrator's live mint melt/mint-quote WS subscriptions + clear its in-flight
    // indices (PR5d). The cashu account wallets' own mint sockets + the Breez SDK `disconnect()`
    // are dropped with the live-handle memos above; the leader-elected processor + its timers are
    // the Slice-5 addition to this same seam.
    await this.connections.orchestrator.destroy();
    // Remove every event subscriber.
    this.connections.events.removeAllListeners();
  }
}
