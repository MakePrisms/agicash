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
import { TypedEventEmitter } from './internal/event-emitter';
import { OpenSecretClient } from './internal/open-secret';
import {
  createAccountsStub,
  createAuthStub,
  createBackgroundStub,
  createCashuStub,
  createContactsStub,
  createExchangeRateStub,
  createScanStub,
  createSparkStub,
  createTransactionsStub,
  createTransfersStub,
  createUserStub,
} from './internal/stub-domains';
import {
  type SupabaseConnectionConfig,
  type WalletSupabaseClient,
  createSupabaseClient,
} from './internal/supabase-client';
import { SupabaseSessionTokenProvider } from './internal/supabase-session';
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
   * Private — construct via {@link Sdk.create}. Takes the assembled connection bundle and
   * wires the domain accessors. PR2 wires every accessor to a stub; later slices replace
   * the stub factories here with real implementations that receive `connections`.
   */
  private constructor(connections: SdkConnections) {
    this.connections = connections;
    this.events = connections.events;

    // --- domain accessors (STUBS in PR2 — swap per slice) --------------------
    this.auth = createAuthStub();
    this.user = createUserStub();
    this.accounts = createAccountsStub();
    this.scan = createScanStub();
    this.cashu = createCashuStub();
    this.spark = createSparkStub();
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
    const sessionToken = new SupabaseSessionTokenProvider(() =>
      openSecret.generateThirdPartyToken(config.supabase.url),
    );

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

    const connections: SdkConnections = {
      supabase,
      openSecret,
      sessionToken,
      storage: config.storage,
      events: new TypedEventEmitter<SdkEventMap>(),
      clientId: config.clientId ?? generateClientId(),
    };

    return new Sdk(connections);
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
    // Remove every event subscriber.
    this.connections.events.removeAllListeners();
    // TODO(Slice 3/5): close mint melt/mint-quote WS subs + Breez SDK instances + halt
    // the leader-elected processor + clear its timers (wired into this seam when opened).
  }
}
