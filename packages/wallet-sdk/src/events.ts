/**
 * Event layer — §11 of the contract. FULLY NET-NEW (no master EventEmitter).
 *
 * PR1 ships the `SdkEventMap` keys + the `EventEmitter<M>` INTERFACE (declaration
 * only — no implementation). `BackgroundState` is defined here (used by
 * `background:state` and `BackgroundDomain.state()`).
 */
import type { Account } from './types/account';
import type { Contact } from './types/contact';
import type { Money } from './types/money';
import type { Transaction } from './types/transaction';
import type { User } from './types/user';
import type { SdkError } from './errors';

/**
 * Lifecycle state of the background processor (see {@link BackgroundDomain}).
 * Reflects whether it is running and whether this instance currently holds the
 * leader lock: `stopped` → `starting` → `follower`/`leader` → `stopping`.
 */
export type BackgroundState =
  | 'stopped'
  | 'starting'
  | 'follower'
  | 'leader'
  | 'stopping';

/**
 * The full set of events the SDK emits, keyed by event name, mapping to that
 * event's payload type. This is the SDK's ONLY reactivity surface — consumers
 * subscribe via {@link EventEmitter} (the web wallet feeds its own read-model
 * from these) rather than polling. Naming is flat with the `protocol` carried in
 * the payload; create vs update is encoded in the event NAME (not a payload
 * flag), and payloads carry the entity `version` for ordering.
 */
export type SdkEventMap = {
  /** A send moved to PENDING (initiated, awaiting settlement). */
  'send:pending': {
    quoteId: string;
    transactionId: string;
    protocol: 'cashu' | 'spark';
  };
  /** A send settled successfully; `amount` is the amount sent. */
  'send:completed': {
    quoteId: string;
    transactionId: string;
    amount: Money;
    protocol: 'cashu' | 'spark';
  };
  /** A send failed terminally; `error` carries the classified reason. */
  'send:failed': {
    quoteId: string;
    error: SdkError;
    protocol: 'cashu' | 'spark';
  };
  /** A receive completed; funds are credited and `amount` is the amount received. */
  'receive:completed': {
    quoteId: string;
    transactionId: string;
    amount: Money;
    protocol: 'cashu' | 'spark';
  };
  /** A receive quote expired before it was paid. */
  'receive:expired': { quoteId: string; protocol: 'cashu' | 'spark' };
  /** A receive failed terminally; `error` carries the classified reason. */
  'receive:failed': {
    quoteId: string;
    error: SdkError;
    protocol: 'cashu' | 'spark';
  };
  // NO transfer:* events (decision 5): a transfer is TWO transactions (debit + credit),
  // reconstructed consumer-side from the two transaction:* events, linked by `transferId`.
  /** An account was created or updated; `op` distinguishes which. */
  'account:updated': { account: Account; op: 'created' | 'updated' };
  /** A new transaction appeared in history. */
  'transaction:created': { transaction: Transaction };
  /** An existing transaction changed state (apply by `transaction.version`). */
  'transaction:updated': { transaction: Transaction };
  /** A contact was added. */
  'contact:created': { contact: Contact };
  /** A contact was removed; only its id is carried. */
  'contact:deleted': { contactId: string };
  /** The user signed in (or a guest/full session became active). */
  'auth:signed-in': { user: User };
  /** The user signed out. */
  'auth:signed-out': Record<string, never>;
  /** The session expired and could not be refreshed; the consumer must re-auth. */
  'auth:session-expired': Record<string, never>;
  /** The background processor changed lifecycle state. */
  'background:state': { state: BackgroundState };
};

/**
 * A read-only, type-safe event subscription surface over an event map `M`.
 * Handlers receive the payload typed to the subscribed event; both methods
 * return an unsubscribe function. The SDK exposes one as `sdk.events`.
 */
export interface EventEmitter<M> {
  /**
   * Subscribe to `event`; `handler` is called on every emission.
   * @returns an unsubscribe function.
   */
  on<K extends keyof M>(event: K, handler: (data: M[K]) => void): () => void;
  /**
   * Subscribe to `event` for a single emission, then auto-unsubscribe.
   * @returns an unsubscribe function (to cancel before it fires).
   */
  once<K extends keyof M>(event: K, handler: (data: M[K]) => void): () => void;
}
