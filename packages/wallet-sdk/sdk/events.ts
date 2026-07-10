import type { Money } from '@agicash/money';
import type { User } from '../domain/user/user';
import type { SdkError } from '../lib/error';
import type { Account } from './accounts';
import type { BackgroundState } from './background';
import type { Contact } from './contacts';
import type {
  CashuReceiveQuote,
  CashuReceiveSwap,
  SparkReceiveQuote,
} from './receive';
import type { CashuSendQuote, CashuSendSwap, SparkSendQuote } from './send';
import type { Transaction } from './transactions';

/**
 * Payloads are decrypted domain objects. Naming: `<entity>.<verb>`, verbs per
 * entity; terminal transitions arrive as `updated` with the new state on the
 * payload. Adding events is non-breaking; renaming is breaking.
 */
export type WalletEventMap = {
  /** The session died without a `signOut()` call (expiry / failed refresh). */
  'auth.session-expired': Record<string, never>;
  /**
   * The SDK refreshed the session without a host-initiated verb — today:
   * guest auto-extension at refresh-token expiry. Host-initiated verbs never
   * fire it (the host knows its own actions). Hosts re-sync session-derived
   * state from it (the web: auth query + session-hint cookie).
   */
  'auth.session-refreshed': Record<string, never>;
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
