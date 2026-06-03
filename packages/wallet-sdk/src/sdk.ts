/**
 * The `Sdk` class SHAPE — §1 of the contract. DECLARATION ONLY (no impl).
 *
 * PR1 ships the public shape via `declare class` (no method bodies / no wiring).
 * The real `Sdk.create` shell + domain-accessor wiring + connection setup land in
 * the core implementation PR (Slice 0 / PR2).
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
export declare class Sdk {
  /**
   * Asynchronously construct and connect an SDK instance: builds the
   * Supabase/OpenSecret/Breez clients from `config` and wires the domains. The
   * SDK owns those clients; the caller only supplies params via {@link SdkConfig}.
   */
  static create(config: SdkConfig): Promise<Sdk>;
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
  /** Type-safe event subscription surface (the SDK's only reactivity channel). */
  readonly events: EventEmitter<SdkEventMap>;
  /**
   * Tear down the instance: close WS subscriptions (mints + Supabase realtime +
   * Breez), halt orchestrators, and clear timers. Call when the consumer is done.
   */
  destroy(): Promise<void>;
}
