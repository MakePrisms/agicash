/**
 * The `Sdk` class — §1 of the contract. The CORE shell + connection wiring (PR2).
 *
 * PR2 turns PR1's `declare class` into a real implementation: `Sdk.create` validates
 * the config, instantiates the connections (OpenSecret client, the SDK-owned Supabase
 * client wired to an internal access-token provider, the storage adapter), constructs
 * the typed event emitter, creates the internal QueryClient for the reactive runtime,
 * and wires each domain accessor to a STUB whose methods throw (`NotImplementedError`)
 * until its slice lands. `destroy()` tears the instance down.
 *
 * What is REAL here: config validation; the OpenSecret/Supabase/storage wiring; the
 * event emitter; the QueryClient; the lifecycle shell. What is STUBBED: all domain
 * business logic (auth, accounts, scan, cashu, spark, transactions, contacts, transfers,
 * exchangeRate, background) — see `./internal/stub-domains` and each slice in the
 * build plan.
 *
 * Session RESUME is automatic: the OpenSecret client rehydrates its persisted session on
 * init (see `./internal/open-secret`), and the Supabase access-token provider lazily
 * fetches a fresh JWT on first DB read.
 */
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
import { AccountsDomainImpl } from './domains/accounts';
import { AuthDomainImpl } from './domains/auth';
import { BackgroundDomainImpl } from './domains/background';
import {
  CashuDomainImpl,
  CashuReceiveOpsImpl,
  CashuSendOpsImpl,
} from './domains/cashu';
import { ScanDomainImpl } from './domains/scan';
import { ContactsDomainImpl } from './domains/contacts';
import { TransactionsDomainImpl } from './domains/transactions';
import { TransfersDomainImpl } from './domains/transfers';
import { UserDomainImpl } from './domains/user';
import { LiveAccountHandleResolver } from './internal/account-handle-resolver';
import { AccountEventForwarder } from './internal/account-event-forwarder';
import { AccountRepository } from './internal/account-repository';
import { BackgroundProcessor } from './internal/background-processor';
import { ContactEventForwarder } from './internal/contact-event-forwarder';
import { ContactRepository } from './internal/contact-repository';
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
import { LeaderElection } from './internal/leader-election';
import { Orchestrator } from './internal/orchestrator';
import { RealtimeHub } from './internal/realtime-hub';
import { ReceiveCashuTokenQuoteService } from './internal/receive-cashu-token-quote-service';
import { SparkBalanceTracker } from './internal/spark-balance-tracker';
import { SparkEventForwarder } from './internal/spark-event-forwarder';
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
import { TaskProcessingLockRepository } from './internal/task-processing-lock-repository';
import { createExchangeRateStub } from './internal/stub-domains';
import { TransactionEventForwarder } from './internal/transaction-event-forwarder';
import { TransactionRepository } from './internal/transaction-repository';
import { TransferService } from './internal/transfer-service';
import {
  type SupabaseConnectionConfig,
  type WalletSupabaseClient,
  createSupabaseClient,
} from './internal/supabase-client';
import { SupabaseSessionTokenProvider } from './internal/supabase-session';
import { UserRepository } from './internal/user-repository';
import { QueryClient } from './query';
import type { AgicashDbAccountWithProofs } from './internal/db-account';
import type { CashuAccount } from './types/account';
import type { EventEmitter, SdkEventMap } from './types/events';

// ---- StorageAdapter (pluggable — web=browser, mcp=fs/sqlite) ----

export interface StorageAdapter {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

// ---- SdkConfig ----

/**
 * Configuration passed to {@link Sdk.create}. The consumer supplies connection
 * params and a storage adapter; the SDK constructs and owns the underlying
 * Supabase / OpenSecret / Breez clients (the consumer never gets a handle).
 */
export type SdkConfig = {
  /** OpenSecret enclave/auth backend (VITE_OPEN_SECRET_API_URL + _CLIENT_ID). */
  openSecret: {
    /** Base URL of the OpenSecret API. */
    url: string;
    /** OpenSecret client/app id. */
    clientId: string;
  };
  /**
   * Supabase DB + realtime connection. Schema is pinned to `wallet`; the access
   * token used is the OpenSecret JWT (so reads/writes are RLS-scoped to the
   * user). `serviceRoleKey` is only supplied when the SDK runs server-side.
   */
  supabase: {
    /** Supabase project URL. */
    url: string;
    /** Supabase anon (public) key. */
    anonKey: string;
    /** Service-role key — server-side use only; omit in the browser. */
    serviceRoleKey?: string;
  };
  /** API key for the Spark/Breez SDK (required for spark accounts). */
  breezApiKey?: string;
  /** Pluggable @agicash/opensecret-sdk storage (web = browser, mcp = fs/sqlite). */
  storage: StorageAdapter;
  /**
   * Leader-election INSTANCE id for background processing; auto-generated if
   * omitted. Distinct from `openSecret.clientId`.
   */
  clientId?: string;
  /**
   * App domain for LN-address composition (Contact.lud16 = `${username}@${domain}`).
   * Defaults to '' — set it for valid LN-address/contact features.
   */
  domain?: string;
};

/**
 * The SDK-internal connection bundle assembled by {@link Sdk.create} and handed to the
 * domain implementations (real ones, in later slices) so they share one Supabase client,
 * one OpenSecret client, one token provider, one storage adapter, and one QueryClient.
 *
 * Not exported from the package barrel — it is the wiring substrate, not public API.
 */
export type SdkConnections = {
  readonly supabase: WalletSupabaseClient;
  readonly openSecret: OpenSecretClient;
  readonly sessionToken: SupabaseSessionTokenProvider;
  readonly storage: StorageAdapter;
  readonly events: TypedEventEmitter<SdkEventMap>;
  /**
   * The SDK-internal TanStack QueryClient. Domain implementations call
   * `toQuery(this.connections.queryClient, key, fn)` to produce `Query<T>`.
   * NEVER exposed to consumers — private wiring only.
   */
  readonly queryClient: QueryClient;
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
  /**
   * Realtime → `transaction:*` event forwarder (Slice 4 defines the shape + emit path). Held so the
   * Slice-5 realtime hub can drive it from the `wallet:${userId}` broadcast channel; it carries no
   * subscription yet.
   */
  readonly transactionEventForwarder: TransactionEventForwarder;
  /**
   * Realtime → `contact:*` event forwarder (Slice 4 defines the shape + emit path). Held for the
   * Slice-5 realtime hub, like {@link transactionEventForwarder}.
   */
  readonly contactEventForwarder: ContactEventForwarder;
  /**
   * The Slice-5 background engine (leader election + the always-on realtime forwarding + the
   * reactive cache-invalidation backstop + the leader-gated resume sweep). Held so `destroy()`
   * halts the leader loop, unsubscribes the realtime channel, and removes the spark Breez listeners.
   */
  readonly backgroundProcessor: BackgroundProcessor;
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
 * `crypto.randomUUID` (available in browsers + Node ≥ 19 / Bun — the SDK's targets).
 */
function generateClientId(): string {
  return crypto.randomUUID();
}

// ---- Sdk ----

/**
 * The Agicash wallet SDK — the single entry point a consumer (the web wallet or
 * the MCP wallet) interacts with. Construct it with {@link Sdk.create}, reach
 * functionality through the domain accessors, subscribe to {@link Sdk.events}
 * for reactivity, and call {@link Sdk.destroy} to tear it down.
 *
 * Observable-fetch methods return `Query<T>` (backed by TanStack Query internally).
 * Writes return `Promise`. All change notifications also flow through `events`.
 * TanStack is entirely hidden — consumers import only `Query<T>` from this package.
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
      transactions: TransactionsDomain;
      contacts: ContactsDomain;
      transfers: TransfersDomain;
      background: BackgroundDomain;
    },
  ) {
    this.connections = connections;
    this.events = connections.events;

    // --- real domains (Slice 1: auth + user; Slice 2: accounts + scan) -------
    this.auth = domains.auth;
    this.user = domains.user;
    this.accounts = domains.accounts;
    this.scan = domains.scan;
    // Slice 3 / PR5b: cashu send + receive ops (executeQuote orchestrator deferred to PR5d).
    this.cashu = domains.cashu;
    // Slice 3 / PR5c: spark send + receive ops (executeQuote orchestrator deferred to PR5d).
    this.spark = domains.spark;
    // Slice 4: transactions + contacts + transfers.
    this.transactions = domains.transactions;
    this.contacts = domains.contacts;
    this.transfers = domains.transfers;
    // Slice 5: background (leader-elected orchestrators + realtime event forwarding + the reactive
    // cache-invalidation backstop).
    this.background = domains.background;

    // --- domain accessors still STUBBED (swap per slice) ---------------------
    this.exchangeRate = createExchangeRateStub();
  }

  /**
   * Create + initialise an SDK instance.
   *
   * Validates `config`, configures the OpenSecret client (which rehydrates any persisted
   * session → session resume), builds the SDK-owned Supabase client wired to the internal
   * access-token provider (the OpenSecret JWT, RLS-scoped), threads the storage adapter,
   * constructs the event emitter, and creates the internal QueryClient. Returns a ready
   * `Sdk` whose domains are stubbed until their slices land.
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

    // QueryClient: SDK-internal TanStack client. Used by toQuery() in domain impls.
    // Never exposed to consumers — wired via SdkConnections.
    const queryClient = new QueryClient();

    const events = new TypedEventEmitter<SdkEventMap>();

    // Live-handle memos (the cashu per-mint protocol metadata + the spark per-wallet
    // connection). Held on the connection bundle so `destroy()` can drop them.
    const mintCache = new MintMetadataCache();
    const sparkCache = new SparkWalletCache();
    // Spark balance source (Breez listeners → `account:updated`). Built here, started by S5. Takes
    // the SDK-internal QueryClient too: on a balance change it invalidates `['accounts']` (the
    // reactive backstop — spark balances never cross the realtime channel, so this is the only
    // place the `accounts.list()` Query learns of them).
    const sparkBalanceTracker = new SparkBalanceTracker(events, queryClient);
    const clientId = config.clientId ?? generateClientId();

    // --- Slice 1: auth + user domains ----------------------------------------
    // The agicash domain `User` is the `wallet.users` row keyed by the OpenSecret user id,
    // so both domains share a session resolver (enclave id → DB row + `auth:*` events) over
    // one user repository. `getCurrentUser` is reactive, so the user domain also takes the
    // SDK-internal QueryClient (it wraps the resolver read via `toQuery`).
    const users = new UserRepository(supabase);
    const session = new SessionResolver(
      openSecret,
      users,
      sessionToken,
      events,
    );
    const guestStorage = new GuestAccountStorage(config.storage);
    const auth = new AuthDomainImpl(openSecret, session, guestStorage);
    const user = new UserDomainImpl(queryClient, session, users);

    // --- Slice 2: accounts + scan domains; Slice 3 (PR5a): the live handle resolver --
    // The account repository reads/writes `wallet.accounts` over the same Supabase client and
    // fills in each account's deferred live-handle fields via the resolver — the REAL one
    // (Slice 3): it initialises the cashu mint wallet (1 h-memo'd keyset/keys fetch + 10 s
    // timeout), decrypts the proofs (OpenSecret-derived key + ECIES), and connects the spark
    // Breez wallet (when a `breezApiKey` is configured). The per-mint + per-spark memos (built
    // above, on the connection bundle) live as long as the SDK and are dropped in `destroy()`.
    // No change to the repository — the resolver seam is the whole point. `accounts` reads are
    // reactive, so the domain also takes the SDK-internal QueryClient (it wraps the DB reads
    // via `toQuery`). `scan.parse` is a connection-free decode action; `allowLocalhost`
    // defaults to false (production).
    const encryption = createEncryption(
      () => openSecret.getEncryptionPrivateKeyHex(),
      () => openSecret.getEncryptionPublicKeyHex(),
    );
    const accountResolver = new LiveAccountHandleResolver({
      encryption,
      getCashuWalletSeed: () => openSecret.getCashuWalletSeed(),
      mintCache,
      getSparkWalletMnemonic: () => openSecret.getSparkWalletMnemonic(),
      sparkCache,
      breezApiKey: config.breezApiKey,
      // Master's `account-repository` default; the Breez SDK persists per-wallet state here.
      sparkStorageDir: './.spark-data',
    });
    const accountRepository = new AccountRepository(supabase, accountResolver);
    const accounts = new AccountsDomainImpl(
      queryClient,
      accountRepository,
      users,
      session,
    );
    const scan = new ScanDomainImpl();

    // --- Slice 3 / PR5b: cashu send + receive ops ----------------------------
    // The cashu repos write/read the `wallet.cashu_{send,receive}_*` tables over the SDK-owned
    // Supabase client + the SDK Encryption (encrypt-on-write / decrypt-on-read of the jsonb +
    // proof ciphertext). The account-returning RPCs (receive payment/complete) map the returned
    // row via the resolver-backed `dbAccountToAccount` (the same live-handle resolver Slice 2
    // wires). The services drive the mint over each account's live `ExtendedCashuWallet` (PR5a),
    // keeping master's idempotency (`wallet.restore`) + DB reservation / CONCURRENCY_ERROR
    // guards. The two `get` reads are REACTIVE — each Ops impl also takes the SDK-internal
    // QueryClient and wraps its repo read via `toQuery` (memoised per id; see `domains/cashu.ts`).
    // `executeQuote` (the orchestrator state machine) + the full `receiveToken` claim flow are
    // DEFERRED to PR5d — PR5b ships the idempotent primitives they sequence.
    const mapCashuAccount = (row: AgicashDbAccountWithProofs) =>
      dbAccountToAccount<CashuAccount>(row, accountResolver);

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
    // listener (`sparkBalanceTracker`, started by S5), NOT a DB trigger. The two `get` reads are
    // REACTIVE — each Ops impl also takes the SDK-internal QueryClient and wraps its service read
    // via `toQuery` (memoised per id; see `domains/spark.ts`). `executeQuote` (the orchestrator
    // state machine) is DEFERRED to PR5d — PR5c ships the idempotent primitives it sequences.
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
        queryClient,
        cashuSendQuoteService,
        cashuSendSwapService,
        cashuSendQuoteRepository,
        cashuSendSwapRepository,
        accountRepository,
        session,
        orchestrator,
      ),
      new CashuReceiveOpsImpl(
        queryClient,
        cashuReceiveQuoteService,
        cashuReceiveQuoteRepository,
        session,
        claimCashuTokenFlow,
      ),
    );

    const spark = new SparkDomainImpl(
      new SparkSendOpsImpl(
        queryClient,
        sparkSendQuoteService,
        session,
        orchestrator,
      ),
      new SparkReceiveOpsImpl(queryClient, sparkReceiveQuoteService, session),
    );

    // --- Slice 4: transactions + contacts + transfers ------------------------
    // Transactions: the repo reads `wallet.transactions` over the SDK Supabase client + Encryption
    // (it decrypts each row's `encrypted_transaction_details` then runs the internal 6-variant
    // DB→domain parser, decision 7-ii); the reactive domain wraps its reads in `Query<T>` over the
    // shared QueryClient. Contacts: the repo reads `wallet.contacts` and computes each contact's
    // `lud16` from `config.domain` (the CONTACT DRIFT reconciliation — `lud16` derived, not stored);
    // its reads are likewise `Query<T>`. Transfers: the service COMPOSES the PR5b/5c cashu + spark
    // send/receive quote services (a transfer = a cashu leg + a spark leg) and auto-fails the
    // receive on a send-persist failure; the domain's createQuote/executeQuote are `Promise`
    // actions over the VERBATIM-FULL `TransferQuote` (each leg's live Lightning quote is plain data,
    // read directly — no symbol carrier).
    const agicashDomain = config.domain ?? '';
    const transactionRepository = new TransactionRepository(
      supabase,
      encryption,
    );
    const contactRepository = new ContactRepository(supabase, agicashDomain);
    const transferService = new TransferService(
      cashuReceiveQuoteService,
      sparkReceiveQuoteService,
      cashuSendQuoteService,
      sparkSendQuoteService,
    );

    const transactions = new TransactionsDomainImpl(
      queryClient,
      transactionRepository,
      session,
    );
    const contacts = new ContactsDomainImpl(
      queryClient,
      contactRepository,
      session,
    );
    const transfers = new TransfersDomainImpl(transferService, session);

    // Realtime → SDK-event forwarders. Slice 4 defined the `transaction:*` / `contact:*` event
    // SHAPES + emit path; the `account:updated` realtime forwarder is the Slice-5 add (the spark
    // balance path already emits `account:updated` off the Breez stream — this covers the
    // cashu-balance / account-metadata DB-trigger updates). The Slice-5 realtime hub (below) drives
    // all three from the `wallet:${userId}` broadcast channel.
    const accountEventForwarder = new AccountEventForwarder(
      accountRepository,
      events,
    );
    const transactionEventForwarder = new TransactionEventForwarder(
      transactionRepository,
      events,
    );
    const contactEventForwarder = new ContactEventForwarder(
      agicashDomain,
      events,
    );

    // --- Slice 5: background (leader election + realtime forwarding + the reactive backstop) ----
    // The leader-election timer loop over the lifted `take_lead` lock; the single `wallet:${userId}`
    // realtime channel; the spark Breez terminal-event substrate (drives spark sends/receives to
    // their terminal state off the Breez stream — spark has no mint WS). All three are owned by the
    // BackgroundProcessor, which reacts to lead transitions, routes realtime broadcasts (the
    // reactive cache-invalidation backstop ALWAYS; the typed event forwarders always; quote/swap →
    // orchestrator when leader), and runs the resume sweep (the no-cache "listPending": enumerate
    // unresolved/pending FROM THE DB + kick each off). The processor holds the SDK-internal
    // QueryClient so each DB-change broadcast invalidates the matching memoised `Query` key(s) (the
    // design-B net-new) and writes the observable `background:state` Query.
    const getUserId = async (): Promise<string | null> => {
      const user = await session.getCurrentUser();
      return user?.id ?? null;
    };
    const lockRepository = new TaskProcessingLockRepository(supabase);
    const sparkEventForwarder = new SparkEventForwarder(orchestrator);

    // `processor` is referenced by the leaderElection/realtimeHub callbacks before it is assigned,
    // so it is captured via a forward reference and the callbacks run only after construction.
    // biome-ignore lint/style/useConst: assigned after the callbacks below close over it (forward ref).
    let processor: BackgroundProcessor;
    const leaderElection = new LeaderElection({
      lockRepository,
      clientId,
      getUserId,
      onChange: (status) => {
        void processor.onLeadChange(status);
      },
    });
    const realtimeHub = new RealtimeHub({
      supabase,
      dispatch: (event, payload) => {
        processor.dispatch(event, payload);
      },
      onConnected: () => {
        void processor.reconcile();
      },
    });
    processor = new BackgroundProcessor({
      events,
      client: queryClient,
      getUserId,
      leaderElection,
      realtimeHub,
      orchestrator,
      accountEventForwarder,
      transactionEventForwarder,
      contactEventForwarder,
      sparkBalanceTracker,
      sparkEventForwarder,
      accounts: accountRepository,
      cashuSendQuoteRepository,
      cashuSendSwapRepository,
      cashuReceiveQuoteRepository,
      cashuReceiveSwapRepository,
      sparkSendQuoteRepository,
      sparkReceiveQuoteRepository,
    });
    const background = new BackgroundDomainImpl(queryClient, processor);

    // The shared connection bundle (held by `Sdk` so `destroy()` can tear everything down). Built
    // last because the orchestrator (PR5d) needs every protocol service/repo constructed first.
    const connections: SdkConnections = {
      supabase,
      openSecret,
      sessionToken,
      storage: config.storage,
      events,
      queryClient,
      clientId,
      mintCache,
      sparkCache,
      sparkBalanceTracker,
      orchestrator,
      transactionEventForwarder,
      contactEventForwarder,
      backgroundProcessor: processor,
    };

    return new Sdk(connections, {
      auth,
      user,
      accounts,
      scan,
      cashu,
      spark,
      transactions,
      contacts,
      transfers,
      background,
    });
  }

  /**
   * Tear down the instance: close WS subscriptions (mints + Supabase realtime + Breez),
   * halt the background orchestrators, clear timers + subscribers, and destroy the
   * QueryClient. Call when the consumer is done with the SDK.
   *
   * Slice 5 finalises this: it first stops the background engine — halting the leader-election
   * timer (and aborting any in-flight `take_lead`), unsubscribing the single `wallet:${userId}`
   * realtime channel, and removing the spark Breez listeners — then closes Supabase realtime, drops
   * the cached session token, clears all event subscribers, destroys the QueryClient, drops the
   * live-handle memos, and closes the orchestrator's mint melt/mint-quote WS subscriptions.
   */
  async destroy(): Promise<void> {
    // Halt the background engine FIRST: stop lead-polling, unsubscribe the realtime channel, and
    // remove the spark Breez balance + terminal-event listeners + clear timers (Slice 5).
    await this.connections.backgroundProcessor.stop();
    // Close any remaining Supabase realtime channels (no-op after the processor's unsubscribe).
    await this.connections.supabase.removeAllChannels();
    // Drop the cached access token.
    this.connections.sessionToken.clear();
    // Remove every event subscriber.
    this.connections.events.removeAllListeners();
    // Clear the QueryClient: cancels in-flight queries, clears the cache.
    this.connections.queryClient.clear();
    // Drop the live-handle memos (cashu mint metadata + connected spark wallets).
    this.connections.mintCache.clear();
    this.connections.sparkCache.clear();
    // Remove the spark Breez balance listeners (the `account:updated` source) — idempotent after the
    // processor stop above (covers a `destroy()` without a prior `background.start()`).
    this.connections.sparkBalanceTracker.stop();
    // Close the orchestrator's live mint melt/mint-quote WS subscriptions + clear its in-flight
    // indices (PR5d). The cashu account wallets' own mint sockets + the Breez SDK `disconnect()`
    // are dropped with the live-handle memos above.
    await this.connections.orchestrator.destroy();
  }
}
