import type { CashuLightningQuote } from './domains/cashu/cashu-send-quote-service';
import type { SparkLightningQuote } from './domains/spark/spark-send-quote-service';
import type { BackgroundState } from './events';
/**
 * Domain interfaces — §2-§10 of the contract. DECLARATIONS ONLY (no impl).
 *
 * Two-mode API rule (Josip 6/01): user-invoked methods take FULL OBJECTS; the
 * exceptions are `get(id)` / `list(filter)` (fetch) and `create*` / `add`
 * (params + the full account). Reactivity is events-only; all methods return
 * Promises.
 */
import type { Account, CashuAccount, SparkAccount } from './types/account';
import type {
  AccountSuggestion,
  AddAccountConfig,
} from './types/account-config';
import type {
  CashuReceiveQuote,
  CashuReceiveSwap,
  CashuSendQuote,
  CashuSendSwap,
  DestinationDetails,
} from './types/cashu';
import type { Contact, UserProfile } from './types/contact';
import type { Rates, Ticker } from './types/exchange-rate';
import type { Currency, Money } from './types/money';
import type { ParsedDestination, PaymentIntent } from './types/scan';
import type { SparkReceiveQuote, SparkSendQuote } from './types/spark';
import type { Transaction, TransactionCursor } from './types/transaction';
import type { TransferQuote, TransferResult } from './types/transfer';
import type { User } from './types/user';

// --- §4 Auth + User --------------------------------------------------------

/**
 * Authentication and session management. The SDK holds the session/JWT
 * internally and attaches it to Supabase/OpenSecret — no consumer reads the
 * token. Sign-in/out also drive the `auth:*` events.
 */
export interface AuthDomain {
  /** Sign in an existing user with email + password; resolves the wallet user. */
  signIn(params: { email: string; password: string }): Promise<User>;
  /** Create a new full (email) account, bootstrap the user row, and sign in. */
  signUp(params: {
    email: string;
    password: string;
    termsAcceptedAt?: string;
    giftCardMintTermsAcceptedAt?: string;
  }): Promise<User>;
  /** Create or resume an anonymous guest user and sign in. */
  signInGuest(params?: {
    termsAcceptedAt?: string;
    giftCardMintTermsAcceptedAt?: string;
  }): Promise<User>;
  /** Sign out the current user and clear the session. */
  signOut(): Promise<void>;
  /** Refresh the current session/access token (extends the session). */
  refresh(): Promise<void>;
  /** Begin a password reset; the caller holds the returned `secret` for `confirmPasswordReset`. */
  resetPassword(email: string): Promise<{ secret: string }>;
  /** Complete a password reset using the emailed code + the held secret. */
  confirmPasswordReset(params: {
    email: string;
    code: string;
    secret: string;
    newPassword: string;
  }): Promise<void>;
  /** Change the signed-in user's password (requires the current password). */
  changePassword(params: { current: string; new: string }): Promise<void>;
  /** Upgrade the current guest into a full email account, preserving funds/history. */
  upgradeGuest(params: { email: string; password: string }): Promise<User>;
  /**
   * Begin Google OAuth. Returns the URL to redirect the browser to — OAuth is a
   * REDIRECT flow. Web-only; the redirect-state stashing stays consumer-side.
   */
  beginGoogleSignIn(): Promise<{ authUrl: string }>;
  /** Complete OAuth from the redirect callback params; bootstraps + resolves the user. */
  completeOAuth(params: {
    code: string;
    state: string;
    termsAcceptedAt?: string;
    giftCardMintTermsAcceptedAt?: string;
  }): Promise<User>;
  /** Verify the user's email with the emailed code; re-resolves (emailVerified flips). */
  verifyEmail(code: string): Promise<User>;
  /** Resend the email-verification code. */
  requestEmailVerificationCode(): Promise<void>;
}

/** The current user and mutations on their profile. */
export interface UserDomain {
  /** The currently signed-in user, or null if none. Runs the ensure-on-resolve bootstrap. */
  getCurrentUser(): Promise<User | null>;
  /** Change the user's username. Throws `DomainError` if the username is taken. */
  updateUsername(username: string): Promise<User>;
  /** Record acceptance of the wallet and/or gift-card-mint terms (sets the timestamp(s) to now). */
  acceptTerms(params: {
    wallet?: boolean;
    giftCardMint?: boolean;
  }): Promise<User>;
  /** Set the user's preferred display currency. */
  setDefaultCurrency(currency: Currency): Promise<User>;
}

// --- §2 Accounts -----------------------------------------------------------

/**
 * Wallet accounts. Per the two-mode API rule, `list`/`get` are fetches (by
 * id/filter) and `add` creates, while `setDefault`/`getBalance` take the FULL
 * account object the caller already holds (the SDK never re-reads it).
 */
export interface AccountsDomain {
  /** All of the user's accounts. */
  list(): Promise<Account[]>;
  /** The account with this id, or null if not found. */
  get(id: string): Promise<Account | null>;
  /** The default account, optionally for a specific currency (defaults are per-currency). */
  getDefault(params?: { currency?: Currency }): Promise<Account | null>;
  /** Create and persist a new account from the given config. */
  add(config: AddAccountConfig): Promise<Account>;
  /**
   * Make `account` the default for its currency. Takes the full object. There is
   * one default PER currency (BTC + USD), not a single global default.
   */
  setDefault(account: Account): Promise<void>;
  /** Current balance of the given account (full object). */
  getBalance(account: Account): Promise<Money>;
  /**
   * Recommend which of the passed-in `accounts` to use for `intent`. PURE over
   * the accounts handed in (no DB read) — the web wallet feeds its cached
   * accounts for an instant result. Cheap-first heuristic (gift-card-mint match
   * + sufficient balance + default fallback); no cross-protocol cost comparison.
   */
  suggestFor(
    intent: PaymentIntent,
    accounts: Account[],
  ): Promise<AccountSuggestion>;
}

// --- §3 Scan ---------------------------------------------------------------

/** Destination parsing for scanned/pasted input. */
export interface ScanDomain {
  /**
   * Classify a raw string into a {@link ParsedDestination} (bolt11 invoice,
   * Lightning address, or cashu token). ln-address → invoice resolution is NOT
   * done here — it happens inside `createLightningQuote`, where the amount is
   * known. Account/gift-card matching is a separate `suggestFor` step.
   */
  parse(input: string): Promise<ParsedDestination>;
}

// --- §5 Cashu --------------------------------------------------------------

/** Cashu send operations: lightning sends, token sends, and reclaiming a pending token send. */
export interface CashuSendOps {
  /**
   * Preview a LIGHTNING send (fees + amounts) WITHOUT persisting or reserving
   * proofs — for the confirmation screen. `createLightningQuote` + `executeQuote`
   * run on confirm. Same params as `createLightningQuote`.
   */
  previewLightningQuote(params: {
    account: CashuAccount;
    destination: string;
    amount?: Money;
  }): Promise<CashuLightningQuote>;
  /**
   * Create a LIGHTNING send quote. `destination` is a bolt11 invoice OR a
   * Lightning address — an ln-address is resolved internally via LNURL-pay using
   * the amount (no separate scan step). `amount` is required for amountless
   * invoices / ln-addresses. `destinationDetails` overrides the internally
   * resolved destination tag — pass it when the caller already knows the send
   * type (e.g. LN_ADDRESS or AGICASH_CONTACT) and supplies a pre-resolved bolt11
   * as `destination`.
   */
  createLightningQuote(params: {
    account: CashuAccount;
    destination: string;
    amount?: Money;
    destinationDetails?: DestinationDetails;
  }): Promise<CashuSendQuote>;
  /**
   * Create a TOKEN send — returns a separate {@link CashuSendSwap} (not a
   * lightning quote). Spends/reserves proofs and prepares them to be encoded into
   * a shareable token.
   */
  createTokenQuote(params: {
    account: CashuAccount;
    amount: Money;
  }): Promise<CashuSendSwap>;
  /**
   * Execute a lightning send. This IS the orchestrator, not a thin kickoff: it
   * contains the background state machine (task processing + mint melt-quote WS
   * subscription) that drives UNPAID → PENDING → PAID, re-validating against the
   * mint. Takes the full quote, resolves on KICK-OFF (returns the quote in its
   * current state); the terminal state arrives via `send:completed`/`send:failed`
   * or by polling `.get(quote.id)`.
   */
  executeQuote(quote: CashuSendQuote): Promise<CashuSendQuote>;
  /** Mark a send quote as failed with the given reason (full object). */
  failQuote(quote: CashuSendQuote, reason: string): Promise<void>;
  /**
   * User-initiated reclaim of a PENDING token send: pulls `proofsToSend` back via
   * a new cashu receive-swap tagged `reversedTransactionId`. Takes the full swap,
   * gated to the PENDING state (there is no orchestrator auto-reverse); the swap
   * lands REVERSED DB-side.
   */
  reverse(swap: CashuSendSwap): Promise<CashuSendSwap>;
  /** Fetch a send quote or token-send swap by id, or null if not found. */
  get(id: string): Promise<CashuSendQuote | CashuSendSwap | null>;
}

/** Cashu receive operations: claim a token, or create a lightning receive quote. */
export interface CashuReceiveOps {
  /**
   * Claim a cashu token. By default it is received to the token's own mint,
   * which returns a {@link CashuReceiveSwap} (no Lightning round-trip). Pass
   * `destinationAccount` to receive cross-account — token → another cashu mint
   * returns a {@link CashuReceiveQuote}, token → spark returns a
   * {@link SparkReceiveQuote} — both done internally via melt-then-mint.
   */
  receiveToken(params: {
    token: string;
    destinationAccount?: Account;
  }): Promise<CashuReceiveQuote | SparkReceiveQuote | CashuReceiveSwap>;
  /**
   * Create a lightning receive quote (an invoice to be paid). `purpose` defaults
   * to `'PAYMENT'`; `'BUY_CASHAPP'` is the buy-bitcoin / Cash App flow (pairs with
   * the `cashAppDeepLink` helper). `description` is threaded to the mint invoice
   * as the bolt11 memo.
   */
  createLightningQuote(params: {
    account: CashuAccount;
    amount: Money;
    purpose?: 'PAYMENT' | 'BUY_CASHAPP';
    description?: string;
  }): Promise<CashuReceiveQuote>;
  /** Fetch a receive quote by id, or null if not found. */
  get(quoteId: string): Promise<CashuReceiveQuote | null>;
}

/**
 * The cashu domain — ecash send/receive. Pending/unresolved enumeration is
 * INTERNAL to the background processor (there is no public `listPending`);
 * consumers observe in-flight state via `transactions` (PENDING) + events.
 */
export interface CashuDomain {
  /** Send operations. */
  send: CashuSendOps;
  /** Receive operations. */
  receive: CashuReceiveOps;
}

// --- §6 Spark --------------------------------------------------------------

/** Spark (Breez) send operations. */
export interface SparkSendOps {
  /**
   * Preview a Spark LIGHTNING send (fees + amounts) WITHOUT persisting — for the
   * confirmation screen. `createLightningQuote` + `executeQuote` run on confirm.
   * Same params as `createLightningQuote`.
   */
  previewLightningQuote(params: {
    account: SparkAccount;
    destination: string;
    amount?: Money;
  }): Promise<SparkLightningQuote>;
  /**
   * Create a Spark lightning send quote. `destination` is a bolt11 invoice OR a
   * Lightning address (resolved internally via LNURL-pay using the amount);
   * `amount` is required for amountless invoices / ln-addresses.
   */
  createLightningQuote(params: {
    account: SparkAccount;
    destination: string;
    amount?: Money;
  }): Promise<SparkSendQuote>;
  /**
   * Execute a Spark lightning send (full object). Calls Breez `sendPayment`,
   * moving the quote UNPAID → PENDING; the terminal state arrives via the Breez
   * callback (surfaced as `send:completed`/`send:failed`).
   */
  executeQuote(quote: SparkSendQuote): Promise<SparkSendQuote>;
  /** Mark a send quote as failed with the given reason (full object). */
  failQuote(quote: SparkSendQuote, reason: string): Promise<void>;
  /** Fetch a Spark send quote by id, or null if not found. */
  get(quoteId: string): Promise<SparkSendQuote | null>;
}

/** Spark (Breez) receive operations. */
export interface SparkReceiveOps {
  /**
   * Create a Spark lightning receive quote (an invoice to be paid). `purpose`
   * defaults to `'PAYMENT'`; `'BUY_CASHAPP'` is the buy-bitcoin / Cash App flow.
   */
  createLightningQuote(params: {
    account: SparkAccount;
    amount: Money;
    description?: string;
    purpose?: 'PAYMENT' | 'BUY_CASHAPP';
  }): Promise<SparkReceiveQuote>;
  /** Fetch a Spark receive quote by id, or null if not found. */
  get(quoteId: string): Promise<SparkReceiveQuote | null>;
}

/**
 * The spark domain — Spark/Breez lightning send/receive. Spark balance is
 * sourced from the Breez SDK's own event listener (not a DB trigger); this
 * domain owns that source and emits `account:updated` with compare-before-emit.
 */
export interface SparkDomain {
  /** Send operations. */
  send: SparkSendOps;
  /** Receive operations. */
  receive: SparkReceiveOps;
}

// --- §7 Transactions -------------------------------------------------------

/** Transaction history: cursor-paginated reads plus user acknowledgement. */
export interface TransactionsDomain {
  /**
   * List transactions, newest-relevant first (state-sorted: PENDING first).
   * Optionally filter by `accountId`, page with `cursor`, and size with
   * `pageSize`. Returns the page plus a `nextCursor` (null when exhausted).
   */
  list(params?: {
    accountId?: string;
    cursor?: TransactionCursor;
    pageSize?: number;
  }): Promise<{
    transactions: Transaction[];
    nextCursor: TransactionCursor | null;
  }>;
  /** Fetch a single transaction by id, or null if not found. */
  get(id: string): Promise<Transaction | null>;
  /** Count transactions whose `acknowledgmentStatus` is `pending` (e.g. for a badge). */
  countPendingAck(): Promise<number>;
  /** Mark a transaction as acknowledged by the user (full object). */
  acknowledge(transaction: Transaction): Promise<void>;
}

// --- §8 Contacts -----------------------------------------------------------

/**
 * Saved contacts. Contacts are CREATE/DELETE only (no `version` column), so the
 * consumer dedupes/orders by op-type + refetch; `add`/`remove` drive the
 * `contact:created`/`contact:deleted` events.
 */
export interface ContactsDomain {
  /** All of the user's saved contacts. */
  list(): Promise<Contact[]>;
  /** Fetch a saved contact by id, or null if not found. */
  get(id: string): Promise<Contact | null>;
  /** Add a contact by username; resolves with the created {@link Contact}. */
  add(params: { username: string }): Promise<Contact>;
  /** Remove a saved contact (full object). */
  remove(contact: Contact): Promise<void>;
  /**
   * Search addable user profiles by query (minimum 3 characters); excludes the
   * user's existing contacts from the results.
   */
  search(params: { query: string }): Promise<UserProfile[]>;
}

// --- §9 Transfers ----------------------------------------------------------

/**
 * Cross-account transfers (cashu↔spark via Lightning). A transfer is executed as
 * a paired send + receive (TWO transactions linked by `transferId`); there are
 * no aggregate `transfer:*` events — the consumer reconstructs status from each
 * transaction's own events. Receive auto-fails if the send fails.
 */
export interface TransfersDomain {
  /**
   * Quote a cross-account transfer: returns an ephemeral {@link TransferQuote}
   * (cost preview, not persisted). Naming mirrors cashu/spark.
   */
  createQuote(params: {
    sourceAccount: Account;
    destinationAccount: Account;
    amount: Money;
  }): Promise<TransferQuote>;
  /**
   * Execute a previously-created transfer quote (full object); resolves with the
   * ids of the two resulting transactions and their shared `transferId`.
   */
  executeQuote(quote: TransferQuote): Promise<TransferResult>;
}

// --- ExchangeRate (multi-provider domain; §12 notes it is exported) --------

/** Fiat/BTC exchange-rate conversion (multi-provider). */
export interface ExchangeRateDomain {
  /** Convert `amount` into the `to` currency at the current rate. */
  convert(params: { amount: Money; to: Currency }): Promise<Money>;
  /** Fetch the current rate(s) for the given ticker(s) (e.g. `'BTC-USD'`). */
  getRates(params: { tickers: Ticker[] }): Promise<Rates>;
  /** Fetch a single current rate string for `ticker`. */
  getRate(ticker: Ticker): Promise<string>;
}

// --- §10 Background --------------------------------------------------------

/**
 * Background processing lifecycle. Leader election is an internal DB-row lock
 * (`wallet.task_processing_locks` + `take_lead` RPC, 5s poll) shared across
 * tabs/devices/processes; only the leader runs the orchestrators (which read the
 * DB as needed). State transitions are surfaced via `background:state`.
 */
export interface BackgroundDomain {
  /** Begin lead-polling and run the orchestrators while this instance is leader. */
  start(): Promise<void>;
  /** Pause processing, letting in-flight operations finish (does not close connections). */
  stop(): Promise<void>;
  /** The current background-processing lifecycle state (synchronous). */
  state(): BackgroundState;
  /** Forward browser online/active status to the SDK's realtime manager (catch-up resilience). */
  setConnectivity(params: { online: boolean; active: boolean }): void;
}
