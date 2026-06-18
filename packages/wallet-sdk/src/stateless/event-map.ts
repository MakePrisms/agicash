import type { Account } from '../domains/account-types';
import type { CashuReceiveQuote } from '../domains/cashu-receive-quote';
import type { CashuReceiveSwap } from '../domains/cashu-receive-swap';
import type { CashuSendQuote } from '../domains/cashu-send-quote';
import type { CashuSendSwap } from '../domains/cashu-send-swap';
import type { Contact } from '../domains/contact';
import type { SparkReceiveQuote } from '../domains/spark-receive-quote';
import type { SparkSendQuote } from '../domains/spark-send-quote';
import type { Transaction } from '../domains/transaction';
import type { User } from '../domains/user-types';
import type { SdkCoreEventMap } from '../events';

/**
 * Variant A widens the core event map with decrypted-entity row events +
 * the A-only `connection:resync` catch-up signal. Removals are state-gated
 * app-side on `:updated`, so only `contact:deleted` carries an explicit delete.
 */
export type SdkEventMapA = SdkCoreEventMap & {
  'user:updated': { entity: User };
  'account:created': { entity: Account };
  'account:updated': { entity: Account };
  'transaction:created': { entity: Transaction };
  'transaction:updated': { entity: Transaction };
  'contact:created': { entity: Contact };
  'contact:deleted': { id: string };
  'cashu-send-quote:created': { entity: CashuSendQuote };
  'cashu-send-quote:updated': { entity: CashuSendQuote };
  'cashu-send-swap:created': { entity: CashuSendSwap };
  'cashu-send-swap:updated': { entity: CashuSendSwap };
  'cashu-receive-quote:created': { entity: CashuReceiveQuote };
  'cashu-receive-quote:updated': { entity: CashuReceiveQuote };
  'cashu-receive-swap:created': { entity: CashuReceiveSwap };
  'cashu-receive-swap:updated': { entity: CashuReceiveSwap };
  'spark-send-quote:created': { entity: SparkSendQuote };
  'spark-send-quote:updated': { entity: SparkSendQuote };
  'spark-receive-quote:created': { entity: SparkReceiveQuote };
  'spark-receive-quote:updated': { entity: SparkReceiveQuote };
  'connection:resync': Record<string, never>;
};
