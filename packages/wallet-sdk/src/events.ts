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

export type BackgroundState =
  | 'stopped'
  | 'starting'
  | 'follower'
  | 'leader'
  | 'stopping';

export type SdkEventMap = {
  'send:pending': { quoteId: string; transactionId: string; protocol: 'cashu' | 'spark' };
  'send:completed': {
    quoteId: string;
    transactionId: string;
    amount: Money;
    protocol: 'cashu' | 'spark';
  };
  'send:failed': { quoteId: string; error: SdkError; protocol: 'cashu' | 'spark' };
  'receive:completed': {
    quoteId: string;
    transactionId: string;
    amount: Money;
    protocol: 'cashu' | 'spark';
  };
  'receive:expired': { quoteId: string; protocol: 'cashu' | 'spark' };
  'receive:failed': { quoteId: string; error: SdkError; protocol: 'cashu' | 'spark' };
  // NO transfer:* events (decision 5): a transfer is TWO transactions (debit + credit),
  // reconstructed consumer-side from the two transaction:* events, linked by `transferId`.
  'account:updated': { account: Account; op: 'created' | 'updated' };
  'transaction:created': { transaction: Transaction };
  'transaction:updated': { transaction: Transaction };
  'contact:created': { contact: Contact };
  'contact:deleted': { contactId: string };
  'auth:signed-in': { user: User };
  'auth:signed-out': Record<string, never>;
  'auth:session-expired': Record<string, never>;
  'background:state': { state: BackgroundState };
};

export interface EventEmitter<M> {
  on<K extends keyof M>(event: K, handler: (data: M[K]) => void): () => void;
  once<K extends keyof M>(event: K, handler: (data: M[K]) => void): () => void;
}
