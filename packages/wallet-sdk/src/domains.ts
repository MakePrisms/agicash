// All domain interfaces — reactive contract (design B)
// Rule: observable fetch -> Query<T>;  derivation -> sync;  action/write -> Promise

import type {
  Account,
  AddAccountConfig,
  CashuAccount,
  SparkAccount,
} from './types/account';
import type {
  CashuReceiveQuote,
  CashuSendQuote,
  CashuSendSwap,
  ReceiveTokenResult,
} from './types/cashu';
import type { Contact } from './types/contact';
import type { BackgroundState } from './types/events';
import type { Currency, Money } from './types/money';
import type { Query } from './types/query';
import type { ParsedDestination, PaymentIntent } from './types/scan';
import type { SparkReceiveQuote, SparkSendQuote } from './types/spark';
import type { Transaction, TransactionCursor } from './types/transaction';
import type { TransferQuote, TransferResult } from './types/transfer';
import type { User, UserProfile } from './types/user';

// ---- AccountSuggestion ----

export type AccountSuggestion = {
  recommended: Account;
  alternatives: Account[]; // sufficient balance, lower priority
  insufficient: Account[];
  reason: string; // e.g. "gift-card-mint match" | "default cashu"
};

// ---- Auth param shapes ----

export type SignInParams = { email: string; password: string };
export type SignUpParams = { email: string; password: string };
export type ChangePasswordParams = { current: string; new: string };
export type UpgradeGuestParams = { email: string; password: string };
export type CompleteOAuthParams = { code: string; state?: string };

// ---- Domains ----

export interface AccountsDomain {
  /** Observable fetch — returns Query<T> */
  list(): Query<Account[]>;
  /** Observable fetch — returns Query<T> */
  get(id: string): Query<Account | null>;
  /** Observable fetch — returns Query<T> */
  getDefault(params?: { currency?: Currency }): Query<Account | null>;
  /** Pure derivation — sync */
  getBalance(account: Account): Money;
  /** Pure derivation over passed-in accounts — sync */
  suggestFor(intent: PaymentIntent, accounts: Account[]): AccountSuggestion;
  add(config: AddAccountConfig): Promise<Account>;
  setDefault(account: Account): Promise<void>;
}

export interface ScanDomain {
  parse(input: string): Promise<ParsedDestination>;
}

export interface AuthDomain {
  signIn(params: SignInParams): Promise<User>;
  signUp(params: SignUpParams): Promise<User>;
  signInGuest(): Promise<User>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  changePassword(params: ChangePasswordParams): Promise<void>;
  upgradeGuest(params: UpgradeGuestParams): Promise<User>;
  /** Web-only; MCP daemon cannot do Google auth */
  beginGoogleSignIn(): Promise<{ authUrl: string }>;
  completeOAuth(params: CompleteOAuthParams): Promise<User>;
}

export interface UserDomain {
  /** Observable fetch — returns Query<T> */
  getCurrentUser(): Query<User | null>;
  /** throws DomainError if the username is taken */
  updateUsername(username: string): Promise<User>;
}

export interface CashuSendOps {
  /** destination = bolt11 OR ln-address (resolved internally via LNURL-pay) */
  createLightningQuote(params: {
    account: CashuAccount;
    destination: string;
    amount?: Money;
  }): Promise<CashuSendQuote>;
  createTokenQuote(params: {
    account: CashuAccount;
    amount: Money;
  }): Promise<CashuSendSwap>;
  /**
   * Orchestrator kickoff — resolves on kick-off; terminal state arrives via send:completed/send:failed.
   * FULL OBJECT — caller passes the quote it just received.
   */
  executeQuote(quote: CashuSendQuote): Promise<CashuSendQuote>;
  failQuote(quote: CashuSendQuote, reason: string): Promise<void>;
  /**
   * User-initiated reclaim of a PENDING token-send.
   * FULL OBJECT; gated PENDING (isTransactionReversable).
   */
  reverse(swap: CashuSendSwap): Promise<CashuSendSwap>;
  /** Observable fetch — returns Query<T> */
  get(id: string): Query<CashuSendQuote | CashuSendSwap | null>;
}

export interface CashuReceiveOps {
  /**
   * Claim a received cashu token. The receive-swap/quote is internal (DB-persisted,
   * processor-driven). Swallows errors to result (mirrors master claimToken).
   * destinationAccount omitted -> default same-mint resolution.
   */
  receiveToken(params: {
    token: string;
    destinationAccount?: Account;
  }): Promise<ReceiveTokenResult>;
  createLightningQuote(params: {
    account: CashuAccount;
    amount: Money;
    purpose?: 'PAYMENT' | 'BUY_CASHAPP';
  }): Promise<CashuReceiveQuote>;
  /** Observable fetch — returns Query<T> */
  get(quoteId: string): Query<CashuReceiveQuote | null>;
}

export interface CashuDomain {
  send: CashuSendOps;
  receive: CashuReceiveOps;
}

export interface SparkSendOps {
  /** destination = bolt11 OR ln-address (resolved internally via LNURL-pay) */
  createLightningQuote(params: {
    account: SparkAccount;
    destination: string;
    amount?: Money;
  }): Promise<SparkSendQuote>;
  /**
   * FULL OBJECT; Breez sendPayment, UNPAID->PENDING, terminal via Breez callback.
   */
  executeQuote(quote: SparkSendQuote): Promise<SparkSendQuote>;
  failQuote(quote: SparkSendQuote, reason: string): Promise<void>;
  /** Observable fetch — returns Query<T> */
  get(quoteId: string): Query<SparkSendQuote | null>;
}

export interface SparkReceiveOps {
  createLightningQuote(params: {
    account: SparkAccount;
    amount: Money;
    description?: string;
    purpose?: 'PAYMENT' | 'BUY_CASHAPP';
  }): Promise<SparkReceiveQuote>;
  /** Observable fetch — returns Query<T> */
  get(quoteId: string): Query<SparkReceiveQuote | null>;
}

export interface SparkDomain {
  send: SparkSendOps;
  receive: SparkReceiveOps;
}

export interface TransactionsDomain {
  /** Observable fetch — returns Query<T> */
  list(params?: {
    accountId?: string;
    cursor?: TransactionCursor;
    pageSize?: number;
  }): Query<{
    transactions: Transaction[];
    nextCursor: TransactionCursor | null;
  }>;
  /** Observable fetch — returns Query<T> */
  get(id: string): Query<Transaction | null>;
  /** Observable fetch — returns Query<T> */
  countPendingAck(): Query<number>;
  acknowledge(transaction: Transaction): Promise<void>;
}

export interface ContactsDomain {
  /** Observable fetch — returns Query<T> */
  list(): Query<Contact[]>;
  /** Observable fetch — returns Query<T> */
  get(id: string): Query<Contact | null>;
  add(params: { username: string }): Promise<Contact>;
  remove(contact: Contact): Promise<void>;
  /** One-shot search — min 3 chars, excludes existing contacts */
  search(params: { query: string }): Promise<UserProfile[]>;
}

export interface TransfersDomain {
  createQuote(params: {
    sourceAccount: Account;
    destinationAccount: Account;
    amount: Money;
  }): Promise<TransferQuote>;
  executeQuote(quote: TransferQuote): Promise<TransferResult>;
}

export interface BackgroundDomain {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Observable fetch — returns Query<T> */
  state(): Query<BackgroundState>;
}

export interface ExchangeRateDomain {
  /** Observable fetch — returns Query<T> */
  get(params: { from: Currency; to: Currency }): Query<Money>;
}
