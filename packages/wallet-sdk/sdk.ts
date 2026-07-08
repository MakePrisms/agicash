// Public contract of @agicash/wallet-sdk. Prose contract:
// docs/superpowers/specs/2026-07-02-wallet-sdk-contract-proposal.md
import type {
  LNURLError,
  LNURLPayParams,
  LNURLPayResult,
  LNURLVerifyResult,
} from '@agicash/lnurl';
import type { Money } from '@agicash/money';
import type { SparkNetwork } from './db/json-models/spark-account-details-db-data';
import type {
  CashuAccount as DomainCashuAccount,
  SparkAccount as DomainSparkAccount,
} from './domain/accounts/account';
import type { Contact as DomainContact } from './domain/contacts/contact';
import type { CashuReceiveQuote as DomainCashuReceiveQuote } from './domain/receive/cashu-receive-quote';
import type { CashuReceiveLightningQuote } from './domain/receive/cashu-receive-quote-core';
import type { CashuReceiveSwap as DomainCashuReceiveSwap } from './domain/receive/cashu-receive-swap';
import type { SparkReceiveQuote as DomainSparkReceiveQuote } from './domain/receive/spark-receive-quote';
import type { SparkReceiveLightningQuote } from './domain/receive/spark-receive-quote-core';
import type { CashuSendQuote as DomainCashuSendQuote } from './domain/send/cashu-send-quote';
import type { CashuLightningQuote } from './domain/send/cashu-send-quote-service';
import type { CashuSendSwap as DomainCashuSendSwap } from './domain/send/cashu-send-swap';
import type { CashuSwapQuote } from './domain/send/cashu-send-swap-service';
import type { SparkSendQuote as DomainSparkSendQuote } from './domain/send/spark-send-quote';
import type { SparkLightningQuote } from './domain/send/spark-send-quote-service';
import type { Transaction as DomainTransaction } from './domain/transactions/transaction';
import type { Cursor } from './domain/transactions/transaction-repository';
import type { TransferQuote } from './domain/transfer/transfer-service';
import type { User } from './domain/user/user';
import type { SdkError } from './lib/error';
import type { FeatureFlag } from './lib/feature-flag-service';
import type { DestinationDetails } from './lib/send-destination';

export type { Cursor };

// Public projections of the domain entities: `userId`/`ownerId` are implicit
// from the session; raw wallet handles and proof material stay internal.

/** Carries `balance` on every rail, never a raw wallet handle or proof material. */
export type CashuAccount = Omit<
  DomainCashuAccount,
  'keysetCounters' | 'proofs' | 'wallet'
> & { balance: Money | null };
export type SparkAccount = Omit<DomainSparkAccount, 'wallet'>;
export type Account = CashuAccount | SparkAccount;

export type Contact = Omit<DomainContact, 'ownerId'>;
export type Transaction = Omit<DomainTransaction, 'userId'>;
export type CashuReceiveQuote = Omit<DomainCashuReceiveQuote, 'userId'>;
export type SparkReceiveQuote = Omit<DomainSparkReceiveQuote, 'userId'>;
export type CashuReceiveSwap = Omit<DomainCashuReceiveSwap, 'userId'>;
export type CashuSendQuote = Omit<DomainCashuSendQuote, 'userId' | 'proofs'>;
export type CashuSendSwap = Omit<
  DomainCashuSendSwap,
  'inputProofs' | 'proofsToSend' | 'userId'
>;
export type SparkSendQuote = Omit<DomainSparkSendQuote, 'userId'>;

/** Host-backed session persistence. */
export type AuthStorage = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

/** Diagnostic sink; the SDK never writes to the console directly. */
export type Logger = {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
};

export type SdkConfig = {
  db: {
    url: string;
    anonKey: string;
  };
  auth: {
    apiUrl: string;
    clientId: string;
    storage: AuthStorage;
  };
  spark: {
    breezApiKey: string;
    /** Default for account creation; the persisted per-account value is authoritative. */
    network: SparkNetwork;
    /** Node hosts; browser default applies. */
    storageDir?: string;
  };
  /** lud16 domain. */
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
   * Front-loads session restore and the Breez WASM load. Resolves when no
   * session exists (a state, not a failure); rejects on actual failures,
   * e.g. `WebAssemblyUnavailableError`. Required before any Spark operation —
   * the SDK does not lazy-load the WASM, so Spark calls without a completed
   * `init()` throw a typed `SdkError`. Non-Spark usage lazy-initializes on
   * first use.
   */
  init(): Promise<void>;
  /**
   * Awaits in-flight background transitions to their next checkpoint, then
   * tears down realtime + background; still-pending namespace promises reject
   * with a typed `SdkError`.
   */
  dispose(): Promise<void>;
};

/** `create` is sync; no I/O. */
export type SdkConstructor = {
  create(config: SdkConfig): Sdk;
};

export type AuthUser = unknown; // settles in step 5 (auth & user)

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
   * Stops background, tears down realtime, clears the stored session; the
   * instance stays usable in anonymous state.
   */
  signOut(): Promise<void>;
  verifyEmail(code: string): Promise<void>;
  requestNewVerificationCode(): Promise<void>;
  convertGuestToFullAccount(email: string, password: string): Promise<void>;
  /** Returns the URL to redirect to. */
  initiateGoogleAuth(): Promise<{ authUrl: string }>;
  /** OAuth callback leg. */
  completeGoogleAuth(params: { code: string; state: string }): Promise<void>;
  /** Sync snapshot; no I/O. */
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
  get(id: string): Promise<Account | null>;
  /** Active accounts of the current user. */
  list(): Promise<Account[]>;
  cashu: {
    add(params: AddCashuAccountParams): Promise<CashuAccount>;
  };
};

export type ContactsApi = {
  get(id: string): Promise<Contact | null>;
  list(): Promise<Contact[]>;
  create(params: CreateContactParams): Promise<Contact>;
  delete(id: string): Promise<void>;
  findContactCandidates(query: string): Promise<Contact[]>;
};

export type TransactionsApi = {
  get(id: string): Promise<Transaction | null>;
  list(params: {
    /** Opaque pagination token from a previous page's `nextCursor`. */
    cursor?: Cursor;
    pageSize?: number;
    accountId?: string;
  }): Promise<{ transactions: Transaction[]; nextCursor: Cursor | null }>;
  countPendingAck(): Promise<number>;
  acknowledge(transactionId: string): Promise<void>;
};

/**
 * `get*` methods are stateless previews; `create*` methods persist and enter
 * the entity into the background lifecycle. Completion is observed via
 * `events`, never called by the host.
 */
export type ReceiveApi = {
  cashu: {
    getLightningQuote(
      params: GetCashuReceiveLightningQuoteParams,
    ): Promise<CashuReceiveLightningQuote>;
    createQuote(
      params: CreateCashuReceiveQuoteParams,
    ): Promise<CashuReceiveQuote>;
    getQuote(id: string): Promise<CashuReceiveQuote | null>;
  };
  spark: {
    getLightningQuote(
      params: GetSparkReceiveLightningQuoteParams,
    ): Promise<SparkReceiveLightningQuote>;
    createQuote(
      params: CreateSparkReceiveQuoteParams,
    ): Promise<SparkReceiveQuote>;
    getQuote(id: string): Promise<SparkReceiveQuote | null>;
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
  getQuote(params: GetTransferQuoteParams): Promise<TransferQuote>; // public projection of TransferQuote settles in step 16
  initiate(params: InitiateTransferParams): Promise<{ transactionId: string }>;
};

/** Flags are a process-local cached read — the one no-cache exception. */
export type FeatureFlagsApi = {
  get(flag: FeatureFlag): boolean;
  /** Cache-change signal; returns unsubscribe. */
  subscribe(listener: () => void): () => void;
};

export type BackgroundState = 'stopped' | 'follower' | 'leader' | 'error';

/**
 * Execution is background-only: a host must run `start()` somewhere or
 * nothing moves money. The executing instance may differ from the initiating
 * one (the leader lock is per-user across devices).
 */
export type BackgroundApi = {
  /**
   * Leader election + processors.
   * @throws {SdkError} when no authenticated session exists.
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
 * Payloads are decrypted domain objects. Naming: `<entity>.<verb>`, verbs per
 * entity; terminal transitions arrive as `updated` with the new state on the
 * payload. Adding events is non-breaking; renaming is breaking.
 */
export type WalletEventMap = {
  /** The session died without a `signOut()` call (expiry / failed refresh). */
  'auth.session-expired': Record<string, never>;
  'user.updated': { user: User };
  'account.created': { account: Account };
  /** A persisted row changed; the payload carries a `version` consumers gate on. */
  'account.updated': { account: Account };
  /** Versionless balance signal from both rails; spark's only balance path. */
  'account.balance-changed': { accountId: string; balance: Money };
  'contact.created': { contact: Contact };
  'contact.deleted': { contact: Contact };
  'transaction.created': { transaction: Transaction };
  'transaction.updated': { transaction: Transaction };
  'cashu-receive-quote.created': { quote: CashuReceiveQuote };
  'cashu-receive-quote.updated': { quote: CashuReceiveQuote };
  'cashu-receive-swap.created': { swap: CashuReceiveSwap };
  'cashu-receive-swap.updated': { swap: CashuReceiveSwap };
  'spark-receive-quote.created': { quote: SparkReceiveQuote };
  'spark-receive-quote.updated': { quote: SparkReceiveQuote };
  'cashu-send-quote.created': { quote: CashuSendQuote };
  'cashu-send-quote.updated': { quote: CashuSendQuote };
  'cashu-send-swap.created': { swap: CashuSendSwap };
  'cashu-send-swap.updated': { swap: CashuSendSwap };
  'spark-send-quote.created': { quote: SparkSendQuote };
  'spark-send-quote.updated': { quote: SparkSendQuote };
  /**
   * Emits on every transition into `connected`, including the initial
   * connection — the invalidate-all signal. `error` is terminal: the channel
   * is dead after retries exhaust, distinct from a long `reconnecting`.
   */
  'connection.changed': { state: 'connected' | 'reconnecting' | 'error' };
  /**
   * Fires on every `state` transition; `error` set on transitions into
   * `'error'`. Per-task errors never change state, so they never fire it.
   */
  'background.state-changed': { state: BackgroundState; error?: SdkError };
};

/**
 * `on()` only registers a handler and is callable with no session; the
 * per-user realtime channel is established when a session comes into
 * existence (login, or `init()` session restore). Returns unsubscribe.
 */
export type WalletEvents = {
  on<K extends keyof WalletEventMap>(
    event: K,
    handler: (payload: WalletEventMap[K]) => void,
  ): () => void;
};

/**
 * Server-side trust model: service-role key, no user session, per-request
 * scope. No `auth`, no `events`, no `background`.
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
      /** Per-request by design — instance state would race on the per-process singleton. */
      bypassAmountValidation?: boolean;
    }): Promise<LNURLPayResult | LNURLError>;
    handleLnurlpVerify(params: {
      encryptedQuoteData: string;
    }): Promise<LNURLVerifyResult | LNURLError>;
  };
};

/** Singleton per process. */
export type ServerSdkConstructor = {
  create(config: ServerSdkConfig): ServerSdk;
};

// Settles in step N — pinned by that slice PR to the public projection of
// today's service types.

export type AcceptTermsParams = unknown; // step 5 (auth & user)
export type SetDefaultAccountParams = unknown; // step 5 (auth & user)
export type SetDefaultCurrencyParams = unknown; // step 5 (auth & user)
export type AddCashuAccountParams = unknown; // step 6 (accounts)
export type CreateContactParams = unknown; // step 7 (contacts)
export type GetCashuReceiveLightningQuoteParams = unknown; // step 9 (cashu receive quote)
export type CreateCashuReceiveQuoteParams = unknown; // step 9 (cashu receive quote)
export type GetSparkReceiveLightningQuoteParams = unknown; // step 11 (spark receive quote)
export type CreateSparkReceiveQuoteParams = unknown; // step 11 (spark receive quote)
export type GetReceiveCashuTokenQuoteParams = unknown; // step 12 (receive cashu token)
export type ReceiveCashuTokenQuote = unknown; // step 12 (receive cashu token)
export type ClaimCashuTokenParams = unknown; // step 12 (receive cashu token)
export type ClaimCashuTokenResult = unknown; // step 12 (receive cashu token)
export type GetCashuSendLightningQuoteParams = unknown; // step 13 (cashu send quote)
export type CreateCashuSendQuoteParams = unknown; // step 13 (cashu send quote)
export type GetCashuSwapQuoteParams = unknown; // step 14 (cashu send swap)
export type CreateCashuSwapParams = unknown; // step 14 (cashu send swap)
export type CreateCashuSwapResult = unknown; // step 14 (cashu send swap)
export type GetSparkSendLightningQuoteParams = unknown; // step 15 (spark send quote)
export type CreateSparkSendQuoteParams = unknown; // step 15 (spark send quote)
export type GetTransferQuoteParams = unknown; // step 16 (transfer)
export type InitiateTransferParams = unknown; // step 16 (transfer)
