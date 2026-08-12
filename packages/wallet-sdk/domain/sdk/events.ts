import type { Money } from '@agicash/money';
import type { Logger } from '.';
import type { SdkError } from '../../lib/error';
import type { Contact } from '../contacts/contact';
import type { Transaction } from '../transactions/transaction';
import type { User } from '../user/user';
import type { Account } from './accounts';
import type {
  CashuReceiveQuote,
  CashuReceiveSwap,
  SparkReceiveQuote,
} from './receive';
import type { CashuSendQuote, CashuSendSwap, SparkSendQuote } from './send';
import type { TaskProcessorState } from './task-processor';

/**
 * Payloads are decrypted domain objects. Naming: `<entity>.<action>` (e.g.
 * `created`, `updated`) per entity; terminal transitions arrive as `updated`
 * with the new state on the payload. Adding events is non-breaking; renaming
 * is breaking.
 */
export type WalletEventMap = {
  /** The session died without a `signOut()` call (expiry / failed refresh). */
  'auth.session-expired': Record<string, never>;
  /**
   * The SDK refreshed the session on its own — today: the guest auto-extension
   * at refresh-token expiry. It never fires for a sign-in, sign-out, or other
   * host-called auth method (the host already knows about those). Hosts re-sync
   * session-derived state from it.
   */
  'auth.session-refreshed': Record<string, never>;
  /**
   * A session settled onto its current user (initial login/restore or a
   * mid-session identity change) and the user was provisioned — carries the
   * provisioned user and their accounts so the host seeds its caches by plain
   * reads. Replay-latest: a handler that subscribes after the establish still
   * receives the most recent payload immediately (the common React case, where
   * the tree mounts after `init()` already established the session).
   */
  'auth.session-started': { user: User; accounts: Account[] };
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
   * The realtime data channel to Supabase — the per-user subscription that
   * streams row changes, not the auth or network connection. `connected` fires
   * on every transition into the connected state (including the first) and is
   * the invalidate-all / refetch-after-a-gap signal; `error` is terminal after
   * retries exhaust, distinct from a long `reconnecting`.
   */
  'connection.changed': { state: 'connected' | 'reconnecting' | 'error' };
  /**
   * Fires on every `state` transition; `error` set on transitions into
   * `'error'`. Per-task errors never change state, so they never fire it.
   */
  'task-processor.state-changed': {
    state: TaskProcessorState;
    error?: SdkError;
  };
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

type Handler = (payload: never) => void;

export class WalletEventEmitter implements WalletEvents {
  private readonly handlers = new Map<keyof WalletEventMap, Set<Handler>>();
  // Retained for replay-latest: the most recent auth.session-started payload,
  // replayed to a handler that subscribes after the establish.
  private lastSessionStarted:
    | WalletEventMap['auth.session-started']
    | undefined;

  constructor(private readonly logger: Logger) {}

  on<K extends keyof WalletEventMap>(
    event: K,
    handler: (payload: WalletEventMap[K]) => void,
  ): () => void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler as Handler);
    this.handlers.set(event, set);
    if (event === 'auth.session-started' && this.lastSessionStarted) {
      this.dispatch(
        handler as (payload: WalletEventMap['auth.session-started']) => void,
        'auth.session-started',
        this.lastSessionStarted,
      );
    }
    return () => {
      set.delete(handler as Handler);
    };
  }

  private dispatch<K extends keyof WalletEventMap>(
    handler: (payload: WalletEventMap[K]) => void,
    event: K,
    payload: WalletEventMap[K],
  ): void {
    try {
      handler(payload);
    } catch (error) {
      this.logger.error(`Event handler for ${event} threw`, error);
    }
  }

  emit<K extends keyof WalletEventMap>(
    event: K,
    payload: WalletEventMap[K],
  ): void {
    if (event === 'auth.session-started') {
      this.lastSessionStarted =
        payload as WalletEventMap['auth.session-started'];
    }
    const set = this.handlers.get(event);
    if (!set) {
      return;
    }
    // Snapshot: a handler that (un)subscribes mid-emit must not change the
    // current dispatch.
    for (const handler of [...set]) {
      this.dispatch(
        handler as (payload: WalletEventMap[K]) => void,
        event,
        payload,
      );
    }
  }

  /**
   * Drops all retained replay-latest payloads so a subscriber that registers
   * after a session end is not replayed the previous session's events (today the
   * retained `auth.session-started` user and accounts; extend here as more events
   * adopt replay-latest). Called by the SDK on session end.
   */
  clear(): void {
    this.lastSessionStarted = undefined;
  }
}
