/**
 * Domain interfaces — §2-§10 of the contract. DECLARATIONS ONLY (no impl).
 *
 * Two-mode API rule (Josip 6/01): user-invoked methods take FULL OBJECTS; the
 * exceptions are `get(id)` / `list(filter)` (fetch) and `create*` / `add`
 * (params + the full account). Reactivity is events-only; all methods return
 * Promises.
 */
import type {
  Account,
  CashuAccount,
  SparkAccount,
} from './types/account';
import type { AccountSuggestion, AddAccountConfig } from './types/account-config';
import type {
  CashuReceiveQuote,
  CashuSendQuote,
  CashuSendSwap,
} from './types/cashu';
import type { Contact, UserProfile } from './types/contact';
import type { Currency, Money } from './types/money';
import type { ParsedDestination, PaymentIntent } from './types/scan';
import type { SparkReceiveQuote, SparkSendQuote } from './types/spark';
import type { Transaction, TransactionCursor } from './types/transaction';
import type { TransferQuote, TransferResult } from './types/transfer';
import type { User } from './types/user';
import type { BackgroundState } from './events';

// --- §4 Auth + User --------------------------------------------------------
export interface AuthDomain {
  signIn(params: { email: string; password: string }): Promise<User>;
  signUp(params: { email: string; password: string }): Promise<User>;
  signInGuest(): Promise<User>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  changePassword(params: { current: string; new: string }): Promise<void>;
  upgradeGuest(params: { email: string; password: string }): Promise<User>;
  // OAuth is a browser REDIRECT, not a synchronous session (web-only; MCP cannot Google-auth).
  beginGoogleSignIn(): Promise<{ authUrl: string }>;
  completeOAuth(params: Record<string, unknown>): Promise<User>;
}

export interface UserDomain {
  getCurrentUser(): Promise<User | null>;
  /** throws DomainError if the username is taken */
  updateUsername(username: string): Promise<User>;
}

// --- §2 Accounts -----------------------------------------------------------
export interface AccountsDomain {
  list(): Promise<Account[]>; // fetch
  get(id: string): Promise<Account | null>; // fetch
  getDefault(params?: { currency?: Currency }): Promise<Account | null>;
  add(config: AddAccountConfig): Promise<Account>; // create
  setDefault(account: Account): Promise<void>; // FULL OBJECT; one default PER currency
  getBalance(account: Account): Promise<Money>; // FULL OBJECT
  /** PURE over passed-in accounts */
  suggestFor(intent: PaymentIntent, accounts: Account[]): Promise<AccountSuggestion>;
}

// --- §3 Scan ---------------------------------------------------------------
export interface ScanDomain {
  parse(input: string): Promise<ParsedDestination>;
}

// --- §5 Cashu --------------------------------------------------------------
export interface CashuSendOps {
  // lightning-send -> CashuSendQuote. destination = bolt11 OR ln-address
  // (an ln-address is resolved internally via LNURL-pay using the amount).
  createLightningQuote(params: {
    account: CashuAccount;
    destination: string;
    amount?: Money;
  }): Promise<CashuSendQuote>;
  // token-send -> a SEPARATE CashuSendSwap
  createTokenQuote(params: { account: CashuAccount; amount: Money }): Promise<CashuSendSwap>;
  // executeQuote drives the LIGHTNING quote's state machine (FULL OBJECT);
  // kicks off, resolves on transition; terminal arrives via event.
  executeQuote(quote: CashuSendQuote): Promise<CashuSendQuote>;
  failQuote(quote: CashuSendQuote, reason: string): Promise<void>;
  // user-initiated reclaim of a PENDING token-send (decision 8); REVERSED lands DB-side.
  reverse(swap: CashuSendSwap): Promise<CashuSendSwap>; // FULL OBJECT; gated PENDING
  get(id: string): Promise<CashuSendQuote | CashuSendSwap | null>; // fetch
}

export interface CashuReceiveOps {
  receiveToken(params: {
    token: string;
    // cross-account: token->cashu, or token->spark via melt-then-mint (internal)
    destinationAccount?: Account;
  }): Promise<CashuReceiveQuote | SparkReceiveQuote>;
  createLightningQuote(params: {
    account: CashuAccount;
    amount: Money;
    purpose?: 'PAYMENT' | 'BUY_CASHAPP';
  }): Promise<CashuReceiveQuote>;
  get(quoteId: string): Promise<CashuReceiveQuote | null>;
}

export interface CashuDomain {
  send: CashuSendOps;
  receive: CashuReceiveOps;
}

// --- §6 Spark --------------------------------------------------------------
export interface SparkSendOps {
  createLightningQuote(params: {
    account: SparkAccount;
    destination: string;
    amount?: Money;
  }): Promise<SparkSendQuote>;
  executeQuote(quote: SparkSendQuote): Promise<SparkSendQuote>; // FULL OBJECT
  failQuote(quote: SparkSendQuote, reason: string): Promise<void>;
  get(quoteId: string): Promise<SparkSendQuote | null>;
}

export interface SparkReceiveOps {
  createLightningQuote(params: {
    account: SparkAccount;
    amount: Money;
    description?: string;
    purpose?: 'PAYMENT' | 'BUY_CASHAPP';
  }): Promise<SparkReceiveQuote>;
  get(quoteId: string): Promise<SparkReceiveQuote | null>;
}

export interface SparkDomain {
  send: SparkSendOps;
  receive: SparkReceiveOps;
}

// --- §7 Transactions -------------------------------------------------------
export interface TransactionsDomain {
  list(params?: {
    accountId?: string;
    cursor?: TransactionCursor;
    pageSize?: number;
  }): Promise<{ transactions: Transaction[]; nextCursor: TransactionCursor | null }>;
  get(id: string): Promise<Transaction | null>;
  countPendingAck(): Promise<number>;
  acknowledge(transaction: Transaction): Promise<void>; // FULL OBJECT
}

// --- §8 Contacts -----------------------------------------------------------
export interface ContactsDomain {
  list(): Promise<Contact[]>;
  get(id: string): Promise<Contact | null>;
  add(params: { username: string }): Promise<Contact>;
  remove(contact: Contact): Promise<void>; // FULL OBJECT
  /** min 3 chars, excludes existing */
  search(params: { query: string }): Promise<UserProfile[]>;
}

// --- §9 Transfers ----------------------------------------------------------
export interface TransfersDomain {
  createQuote(params: {
    sourceAccount: Account;
    destinationAccount: Account;
    amount: Money;
  }): Promise<TransferQuote>;
  executeQuote(quote: TransferQuote): Promise<TransferResult>; // FULL OBJECT
}

// --- ExchangeRate (multi-provider domain; §12 notes it is exported) --------
export interface ExchangeRateDomain {
  /**
   * Convert `amount` into `to` currency at the current rate.
   * TODO(post-PR1): ground the method surface against
   * `app/lib/exchange-rate/**` when the domain is implemented.
   */
  convert(params: { amount: Money; to: Currency }): Promise<Money>;
}

// --- §10 Background --------------------------------------------------------
export interface BackgroundDomain {
  start(): Promise<void>;
  stop(): Promise<void>;
  state(): BackgroundState;
}
