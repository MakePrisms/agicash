/**
 * @agicash/wallet-sdk public contract — the types the migration slices
 * implement against. Prose contract (semantics, invariants, rationale):
 * docs/superpowers/specs/2026-07-02-wallet-sdk-contract-proposal.md
 *
 * Shapes marked "settles in step N" are placeholders a slice PR pins to the
 * public projection of today's service types (internals like `userId` and raw
 * wallet handles never appear on the public surface).
 */
import type {
  LNURLError,
  LNURLPayParams,
  LNURLPayResult,
  LNURLVerifyResult,
} from '@agicash/lnurl';
import type { Money } from '@agicash/money';
import type { SparkNetwork } from './db/json-models/spark-account-details-db-data';
import type { CashuAccount, SparkAccount } from './domain/accounts/account';
import type { Contact } from './domain/contacts/contact';
import type { CashuReceiveQuote } from './domain/receive/cashu-receive-quote';
import type { CashuReceiveLightningQuote } from './domain/receive/cashu-receive-quote-core';
import type { CashuReceiveSwap } from './domain/receive/cashu-receive-swap';
import type { SparkReceiveQuote } from './domain/receive/spark-receive-quote';
import type { SparkReceiveLightningQuote } from './domain/receive/spark-receive-quote-core';
import type { CashuSendQuote } from './domain/send/cashu-send-quote';
import type { CashuLightningQuote } from './domain/send/cashu-send-quote-service';
import type { CashuSendSwap } from './domain/send/cashu-send-swap';
import type { CashuSwapQuote } from './domain/send/cashu-send-swap-service';
import type { SparkSendQuote } from './domain/send/spark-send-quote';
import type { SparkLightningQuote } from './domain/send/spark-send-quote-service';
import type { Transaction } from './domain/transactions/transaction';
import type { Cursor } from './domain/transactions/transaction-repository';
import type { User } from './domain/user/user';
import type { SdkError } from './lib/error';
import type { FeatureFlag } from './lib/feature-flag-service';
import type { DestinationDetails } from './lib/send-destination';

export type { Cursor };

// --- Public entity projections ---------------------------------------------
// The contract returns and emits public projections of the domain entities:
// `userId`/`ownerId` are implicit from the session, and raw wallet handles /
// proof material never appear on the public surface. Each projection takes
// the bare domain name once its slice flips the web imports off /temporary.

/**
 * The contract account: carries `balance` on every rail, never a raw wallet
 * handle or proof material. The exact cashu field set (e.g. whether
 * `keysetCounters` stays internal) settles in the accounts slice (step 6).
 */
export type SdkCashuAccount = Omit<
  CashuAccount,
  'keysetCounters' | 'proofs' | 'wallet'
> & { balance: Money | null };
export type SdkSparkAccount = Omit<SparkAccount, 'wallet'>;
export type SdkAccount = SdkCashuAccount | SdkSparkAccount;

export type SdkContact = Omit<Contact, 'ownerId'>;
export type SdkTransaction = Omit<Transaction, 'userId'>;
export type SdkCashuReceiveQuote = Omit<CashuReceiveQuote, 'userId'>;
export type SdkSparkReceiveQuote = Omit<SparkReceiveQuote, 'userId'>;
export type SdkCashuReceiveSwap = Omit<CashuReceiveSwap, 'userId'>;
export type SdkCashuSendQuote = Omit<CashuSendQuote, 'userId'>;
export type SdkCashuSendSwap = Omit<CashuSendSwap, 'userId'>;
export type SdkSparkSendQuote = Omit<SparkSendQuote, 'userId'>;

/**
 * Host-backed session persistence. Binds to the React-agnostic
 * `@agicash/opensecret` release's storage-provider interface verbatim (method
 * names + nullability), settled when the auth slice (step 5) adopts the
 * release, so the SDK ships no adapter over it.
 */
export type AuthStorage = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

/**
 * Structured diagnostics. Web wires console + Sentry breadcrumbs; a bun/node
 * MCP host wires stderr (stdout carries JSON-RPC). The SDK never calls
 * `console` directly.
 */
export type Logger = {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
};

export type SdkConfig = {
  db: {
    /** Supabase project URL — the host resolves the final URL before `create()`. */
    url: string;
    anonKey: string;
  };
  auth: {
    /** Open Secret backend URL. */
    apiUrl: string;
    /** Open Secret client id. */
    clientId: string;
    storage: AuthStorage;
  };
  spark: {
    breezApiKey: string;
    /**
     * Default used when the SDK creates an account; the per-account value
     * persisted in the DB is authoritative for every account after that.
     */
    network: SparkNetwork;
    /** Node hosts; browser default applies. */
    storageDir?: string;
  };
  /** lud16 domain for contacts/display. */
  lightningAddressDomain: string;
  logger?: Logger;
};

export type Sdk = {
  readonly auth: AuthApi;
  readonly user: UserApi;
  readonly accounts: AccountsApi;
  readonly contacts: ContactsApi;
  readonly transactions: TransactionsApi;
  readonly receive: ReceiveApi;
  readonly send: SendApi;
  readonly transfer: TransferApi;
  readonly featureFlags: FeatureFlagsApi;
  readonly events: WalletEvents;
  readonly background: BackgroundApi;
  /**
   * Optional async second phase: front-loads the inits that can fail —
   * session restore and the Breez WASM probe. Resolves when no session exists
   * (absence of a session is a state, not a failure); rejects only on actual
   * failures, e.g. `WebAssemblyUnavailableError`. Never called → first use
   * lazy-initializes.
   */
  init(): Promise<void>;
  /**
   * Awaits in-flight background transitions to their next checkpoint, then
   * tears down realtime + background; still-pending namespace promises reject
   * with a typed `SdkError`.
   */
  dispose(): Promise<void>;
};

/** The implementing class satisfies this statically: `create` is sync, no I/O. */
export type SdkConstructor = {
  create(config: SdkConfig): Sdk;
};

export type AuthUser = unknown; // settles in step 5: binds to the @agicash/opensecret release's user shape

export type AuthSession =
  | { isLoggedIn: true; user: AuthUser }
  | { isLoggedIn: false };

export type AuthApi = {
  /** Creates a full account and signs the user in. */
  signUp(email: string, password: string): Promise<void>;
  /** Re-signs-in this device's prior guest account if one exists. */
  signUpGuest(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  /**
   * Stops background, tears down realtime, clears the stored session. The
   * instance stays alive in anonymous state — `dispose()` is instance
   * teardown, not logout.
   */
  signOut(): Promise<void>;
  verifyEmail(code: string): Promise<void>;
  requestNewVerificationCode(): Promise<void>;
  convertGuestToFullAccount(email: string, password: string): Promise<void>;
  /** Host redirects to `authUrl`. */
  initiateGoogleAuth(): Promise<{ authUrl: string }>;
  /** OAuth callback leg. */
  completeGoogleAuth(params: { code: string; state: string }): Promise<void>;
  /** Sync snapshot for route guards; no I/O. */
  getSession(): AuthSession;
};

export type UserApi = {
  get(): Promise<User>;
  updateUsername(username: string): Promise<User>;
  acceptTerms(params: AcceptTermsParams): Promise<User>;
  setDefaultAccount(params: SetDefaultAccountParams): Promise<User>;
  setDefaultCurrency(params: SetDefaultCurrencyParams): Promise<User>;
};

export type AccountsApi = {
  get(id: string): Promise<SdkAccount | null>;
  /** Active accounts of the current user. */
  list(): Promise<SdkAccount[]>;
  cashu: {
    add(params: AddCashuAccountParams): Promise<SdkCashuAccount>;
  };
};

export type ContactsApi = {
  get(id: string): Promise<SdkContact | null>;
  list(): Promise<SdkContact[]>;
  create(params: CreateContactParams): Promise<SdkContact>;
  delete(id: string): Promise<void>;
  findContactCandidates(query: string): Promise<SdkContact[]>;
};

export type TransactionsApi = {
  get(id: string): Promise<SdkTransaction | null>;
  list(params: {
    /** Opaque pagination token from a previous page's `nextCursor`. */
    cursor?: Cursor;
    pageSize?: number;
    accountId?: string;
  }): Promise<{ transactions: SdkTransaction[]; nextCursor: Cursor | null }>;
  countPendingAck(): Promise<number>;
  acknowledge(transactionId: string): Promise<void>;
};

/**
 * `get*` methods are stateless previews — they compute and return without
 * persisting. `create*` methods persist and enter the entity into the
 * background lifecycle. Completion is not the host's job: execution is
 * background-only, observed via `events` (subscribe first, then read the
 * baseline — see "Observing an initiated payment" in the contract doc).
 */
export type ReceiveApi = {
  cashu: {
    getLightningQuote(
      params: GetCashuReceiveLightningQuoteParams,
    ): Promise<CashuReceiveLightningQuote>;
    createQuote(
      params: CreateCashuReceiveQuoteParams,
    ): Promise<SdkCashuReceiveQuote>;
    getQuote(id: string): Promise<SdkCashuReceiveQuote | null>;
  };
  spark: {
    getLightningQuote(
      params: GetSparkReceiveLightningQuoteParams,
    ): Promise<SparkReceiveLightningQuote>;
    createQuote(
      params: CreateSparkReceiveQuoteParams,
    ): Promise<SdkSparkReceiveQuote>;
    getQuote(id: string): Promise<SdkSparkReceiveQuote | null>;
  };
  cashuToken: {
    getQuote(
      params: GetReceiveCashuTokenQuoteParams,
    ): Promise<ReceiveCashuTokenQuote>;
    claim(params: ClaimCashuTokenParams): Promise<ClaimCashuTokenResult>;
  };
};

export type SendApi = {
  resolveDestination(input: string): Promise<DestinationDetails>;
  cashu: {
    getLightningQuote(
      params: GetCashuSendLightningQuoteParams,
    ): Promise<CashuLightningQuote>;
    createQuote(
      params: CreateCashuSendQuoteParams,
    ): Promise<{ transactionId: string }>;
    /** Send-to-token. */
    getSwapQuote(params: GetCashuSwapQuoteParams): Promise<CashuSwapQuote>;
    createSwap(params: CreateCashuSwapParams): Promise<CreateCashuSwapResult>;
  };
  spark: {
    getLightningQuote(
      params: GetSparkSendLightningQuoteParams,
    ): Promise<SparkLightningQuote>;
    createQuote(
      params: CreateSparkSendQuoteParams,
    ): Promise<{ transactionId: string }>;
  };
};

export type TransferApi = {
  /** Stateless preview. */
  getQuote(params: GetTransferQuoteParams): Promise<SdkTransferQuote>;
  initiate(params: InitiateTransferParams): Promise<{ transactionId: string }>;
};

/**
 * Feature flags are the documented process-local cache exception (contract
 * principles, rule 1) — hence the sync `get` + `subscribe` pair instead of
 * promises.
 */
export type FeatureFlagsApi = {
  get(flag: FeatureFlag): boolean;
  /** Cache-change signal (web: `useSyncExternalStore`); returns unsubscribe. */
  subscribe(listener: () => void): () => void;
};

export type BackgroundState = 'stopped' | 'follower' | 'leader' | 'error';

/**
 * Nothing moves money unless a background loop is running somewhere: an MCP /
 * request-response host MUST call `start()` in-process, or its own sends sit
 * UNPAID forever. The executing instance may differ from the initiating one
 * (the leader lock is per-user across devices).
 */
export type BackgroundApi = {
  /**
   * Leader election + processors.
   * @throws {SdkError} when no authenticated session exists — background work
   * is per-user by construction.
   */
  start(): void;
  /**
   * Stops claiming new work immediately, awaits in-flight iterations to their
   * next checkpoint (bounded by a timeout), releases the leader lock, and
   * abandons the remaining queue.
   */
  stop(): Promise<void>;
  readonly state: BackgroundState;
};

/**
 * Payloads are decrypted domain objects. Naming invariant: `<entity>.<verb>`,
 * verbs per entity (an entity emits the verbs its data model supports);
 * terminal transitions arrive as `updated` with the new state on the payload.
 * Event names are stable contract; adding events is non-breaking, renaming is
 * breaking.
 */
export type WalletEventMap = {
  /**
   * The session died without a `signOut()` call (expiry / failed refresh) —
   * the host renders its "session expired" path from this one subscription.
   */
  'auth.session-expired': Record<string, never>;
  'user.updated': { user: User };
  'account.created': { account: SdkAccount };
  /** A persisted row changed; the payload carries a `version` consumers gate on. */
  'account.updated': { account: SdkAccount };
  /**
   * Versionless balance signal, both rails: cashu alongside the versioned
   * `account.updated` for the same change, spark from the SDK's internal
   * Breez listeners (spark's only balance path — spark balances are rail-side
   * state, not rows).
   */
  'account.balance-changed': { accountId: string; balance: Money };
  'contact.created': { contact: SdkContact };
  'contact.deleted': { contact: SdkContact };
  'transaction.created': { transaction: SdkTransaction };
  'transaction.updated': { transaction: SdkTransaction };
  'cashu-receive-quote.created': { quote: SdkCashuReceiveQuote };
  'cashu-receive-quote.updated': { quote: SdkCashuReceiveQuote };
  'cashu-receive-swap.created': { swap: SdkCashuReceiveSwap };
  'cashu-receive-swap.updated': { swap: SdkCashuReceiveSwap };
  'spark-receive-quote.created': { quote: SdkSparkReceiveQuote };
  'spark-receive-quote.updated': { quote: SdkSparkReceiveQuote };
  'cashu-send-quote.created': { quote: SdkCashuSendQuote };
  'cashu-send-quote.updated': { quote: SdkCashuSendQuote };
  'cashu-send-swap.created': { swap: SdkCashuSendSwap };
  'cashu-send-swap.updated': { swap: SdkCashuSendSwap };
  'spark-send-quote.created': { quote: SdkSparkSendQuote };
  'spark-send-quote.updated': { quote: SdkSparkSendQuote };
  /**
   * Emits on every transition into `connected` — including the initial
   * connection — as the host's invalidate-all signal. `error` is terminal:
   * the channel is dead after retries exhaust, distinct from a long
   * `reconnecting`.
   */
  'connection.changed': { state: 'connected' | 'reconnecting' | 'error' };
  /**
   * Fires on every `state` transition; `error` set on transitions into
   * `'error'`. Per-task errors don't change state, so they never fire it.
   */
  'background.state-changed': { state: BackgroundState; error?: SdkError };
};

/**
 * `on()` never initiates the realtime connection — it only registers a
 * handler, and is callable with no session. The per-user channel is
 * established by the session coming into existence (login, or `init()`'s
 * session restore).
 */
export type WalletEvents = {
  on<K extends keyof WalletEventMap>(
    event: K,
    handler: (payload: WalletEventMap[K]) => void,
  ): () => void;
};

/**
 * Lightning-address routes run server-side with different trust: env-provided
 * secrets, no user session, per-request scope. `db` uses the service-role key
 * (cross-user reads with no user session, where anon + RLS returns nothing).
 * No `auth` port, no `events`, no `background`.
 */
export type ServerSdkConfig = {
  db: { url: string; serviceRoleKey: string };
  spark: {
    breezApiKey: string;
    network: SparkNetwork;
    mnemonic: string;
    storageDir: string;
  };
  /** Hex; encrypts LNURL verify payloads. */
  quoteEncryptionKey: string;
};

export type ServerSdk = {
  readonly lightningAddress: {
    handleLud16Request(params: {
      username: string;
      baseUrl: string;
    }): Promise<LNURLPayParams | LNURLError>;
    handleLnurlpCallback(params: {
      userId: string;
      amount: Money<'BTC'>;
      baseUrl: string;
      /**
       * Selects the agicash→agicash pay path; per-request by design — as
       * instance state it would race across concurrent requests on the
       * per-process singleton.
       */
      bypassAmountValidation?: boolean;
    }): Promise<LNURLPayResult | LNURLError>;
    handleLnurlpVerify(params: {
      encryptedQuoteData: string;
    }): Promise<LNURLVerifyResult | LNURLError>;
  };
};

/** Singleton per process; the `Request` of the route becomes per-method `baseUrl`. */
export type ServerSdkConstructor = {
  create(config: ServerSdkConfig): ServerSdk;
};

// --- Slice-settled shapes -------------------------------------------------
// Each alias is pinned by its slice PR to the public projection of today's
// service types. They exist now so the namespace structure, method names, and
// return types are compiler-checked contract from step 4 on.

export type AcceptTermsParams = unknown; // settles in step 5 (auth & user)
export type SetDefaultAccountParams = unknown; // settles in step 5 (auth & user)
export type SetDefaultCurrencyParams = unknown; // settles in step 5 (auth & user)
export type AddCashuAccountParams = unknown; // settles in step 6 (accounts)
export type CreateContactParams = unknown; // settles in step 7 (contacts)
export type GetCashuReceiveLightningQuoteParams = unknown; // settles in step 9 (cashu receive quote)
export type CreateCashuReceiveQuoteParams = unknown; // settles in step 9 (cashu receive quote)
export type GetSparkReceiveLightningQuoteParams = unknown; // settles in step 11 (spark receive quote)
export type CreateSparkReceiveQuoteParams = unknown; // settles in step 11 (spark receive quote)
export type GetReceiveCashuTokenQuoteParams = unknown; // settles in step 12 (receive cashu token)
export type ReceiveCashuTokenQuote = unknown; // settles in step 12 (today: CrossAccountReceiveQuotesResult)
export type ClaimCashuTokenParams = unknown; // settles in step 12 (receive cashu token)
export type ClaimCashuTokenResult = unknown; // settles in step 12 (receive cashu token)
export type GetCashuSendLightningQuoteParams = unknown; // settles in step 13 (cashu send quote)
export type CreateCashuSendQuoteParams = unknown; // settles in step 13 (cashu send quote)
export type GetCashuSwapQuoteParams = unknown; // settles in step 14 (cashu send swap)
export type CreateCashuSwapParams = unknown; // settles in step 14 (cashu send swap)
export type CreateCashuSwapResult = unknown; // settles in step 14 (cashu send swap)
export type GetSparkSendLightningQuoteParams = unknown; // settles in step 15 (spark send quote)
export type CreateSparkSendQuoteParams = unknown; // settles in step 15 (spark send quote)
export type GetTransferQuoteParams = unknown; // settles in step 16 (transfer)
export type InitiateTransferParams = unknown; // settles in step 16 (transfer)
export type SdkTransferQuote = unknown; // settles in step 16 (transfer): public projection of today's TransferQuote — must not embed raw accounts
