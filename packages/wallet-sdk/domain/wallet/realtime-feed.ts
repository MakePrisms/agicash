import {
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeClient,
} from '@supabase/supabase-js';
import type {
  AgicashDb,
  AgicashDbAccountWithProofs,
  AgicashDbCashuProof,
  AgicashDbCashuReceiveQuote,
  AgicashDbCashuReceiveSwap,
  AgicashDbCashuSendQuote,
  AgicashDbCashuSendSwap,
  AgicashDbContact,
  AgicashDbSparkReceiveQuote,
  AgicashDbSparkSendQuote,
  AgicashDbTransaction,
  AgicashDbUser,
} from '../../db/database';
import type { Encryption } from '../../lib/encryption';
import {
  type RunScope,
  type RunScopes,
  type ScopeClock,
  createRunScopes,
} from '../../lib/run-scope';
import type { Account } from '../accounts/account';
import type { AccountRepository } from '../accounts/account-repository';
import { ContactRepository } from '../contacts/contact-repository';
import type { CashuReceiveQuote } from '../receive/cashu-receive-quote';
import { CashuReceiveQuoteRepository } from '../receive/cashu-receive-quote-repository';
import type { CashuReceiveSwap } from '../receive/cashu-receive-swap';
import { CashuReceiveSwapRepository } from '../receive/cashu-receive-swap-repository';
import type { SparkReceiveQuote } from '../receive/spark-receive-quote';
import { SparkReceiveQuoteRepository } from '../receive/spark-receive-quote-repository';
import type {
  ActivityMonitor,
  AuthSession,
  Logger,
  WalletEventMap,
} from '../sdk';
import type { CashuSendQuote } from '../send/cashu-send-quote';
import { CashuSendQuoteRepository } from '../send/cashu-send-quote-repository';
import type { CashuSendSwap } from '../send/cashu-send-swap';
import { CashuSendSwapRepository } from '../send/cashu-send-swap-repository';
import type { SparkSendQuote } from '../send/spark-send-quote';
import { SparkSendQuoteRepository } from '../send/spark-send-quote-repository';
import type { Transaction } from '../transactions/transaction';
import { TransactionRepository } from '../transactions/transaction-repository';
import { ReadUserRepository } from '../user/user-repository';

export const RETRY_DELAYS_MS = [
  0, 100, 500, 1000, 3000, 6000, 10000, 20000, 30000,
];

/** The `connection.changed` and domain events the feed emits. */
export type FeedEvent =
  | 'connection.changed'
  | 'user.updated'
  | 'account.created'
  | 'account.updated'
  | 'contact.created'
  | 'contact.deleted'
  | 'transaction.created'
  | 'transaction.updated'
  | 'cashu-receive-quote.created'
  | 'cashu-receive-quote.updated'
  | 'cashu-receive-swap.created'
  | 'cashu-receive-swap.updated'
  | 'spark-receive-quote.created'
  | 'spark-receive-quote.updated'
  | 'cashu-send-quote.created'
  | 'cashu-send-quote.updated'
  | 'cashu-send-swap.created'
  | 'cashu-send-swap.updated'
  | 'spark-send-quote.created'
  | 'spark-send-quote.updated';

export type FeedEmission = {
  [K in FeedEvent]: { event: K; payload: WalletEventMap[K] };
}[FeedEvent];

/** A joined channel; `leave()` resolves once the channel is removed and its topic is free for a new join. */
export type RealtimeJoin = { leave(): Promise<void> };

/** The narrow seam over realtime-js the feed drives; faked in tests. */
export type RealtimeTransport = {
  /** Re-resolves the access token for the socket (`realtime.setAuth()`). */
  refreshAuth(): Promise<void>;
  /** Joins a private broadcast channel and reports its status changes. */
  join(
    topic: string,
    listener: {
      onBroadcast(event: string, payload: unknown): void;
      onStatus(status: REALTIME_SUBSCRIBE_STATES, error?: Error): void;
    },
  ): RealtimeJoin;
};

export function createSupabaseRealtimeTransport(
  client: RealtimeClient,
): RealtimeTransport {
  return {
    refreshAuth: () => client.setAuth(),
    join(topic, listener) {
      const channel = client
        .channel(topic, { config: { private: true } })
        .on('broadcast', { event: '*' }, ({ event, payload }) =>
          listener.onBroadcast(event, payload),
        )
        .subscribe((status, error) => listener.onStatus(status, error));
      return {
        leave: async () => {
          const status = await client.removeChannel(channel);
          if (status === 'error') {
            // An 'error' leave reply skips the channel's close hook, so the
            // topic stays registered and channel(topic) would return it.
            client.channels = client.channels.filter((c) => c !== channel);
            channel.teardown();
          }
        },
      };
    },
  };
}

/**
 * Repository mappers for one decode. Tests pass stubs; the feed builds the
 * real repositories from the session's db, encryption, and account repository.
 */
export type RealtimeRouteContext = {
  accountRepository: {
    toAccount(row: AgicashDbAccountWithProofs): Promise<Account>;
  };
  transactionRepository: {
    toTransaction(row: AgicashDbTransaction): Promise<Transaction>;
  };
  cashuReceiveQuoteRepository: {
    toQuote(row: AgicashDbCashuReceiveQuote): Promise<CashuReceiveQuote>;
  };
  cashuReceiveSwapRepository: {
    toReceiveSwap(row: AgicashDbCashuReceiveSwap): Promise<CashuReceiveSwap>;
  };
  cashuSendQuoteRepository: {
    toQuote(
      row: AgicashDbCashuSendQuote & { cashu_proofs: AgicashDbCashuProof[] },
    ): Promise<CashuSendQuote>;
  };
  cashuSendSwapRepository: {
    toSwap(
      row: AgicashDbCashuSendSwap & { cashu_proofs: AgicashDbCashuProof[] },
    ): Promise<CashuSendSwap>;
  };
  sparkReceiveQuoteRepository: {
    toQuote(row: AgicashDbSparkReceiveQuote): Promise<SparkReceiveQuote>;
  };
  sparkSendQuoteRepository: {
    toQuote(row: AgicashDbSparkSendQuote): Promise<SparkSendQuote>;
  };
  lightningAddressDomain: string;
};

const BROADCAST_EVENTS = [
  'ACCOUNT_CREATED',
  'ACCOUNT_UPDATED',
  'TRANSACTION_CREATED',
  'TRANSACTION_UPDATED',
  'CASHU_RECEIVE_QUOTE_CREATED',
  'CASHU_RECEIVE_QUOTE_UPDATED',
  'CASHU_RECEIVE_SWAP_CREATED',
  'CASHU_RECEIVE_SWAP_UPDATED',
  'CASHU_SEND_QUOTE_CREATED',
  'CASHU_SEND_QUOTE_UPDATED',
  'CASHU_SEND_SWAP_CREATED',
  'CASHU_SEND_SWAP_UPDATED',
  'CONTACT_CREATED',
  'CONTACT_DELETED',
  'SPARK_RECEIVE_QUOTE_CREATED',
  'SPARK_RECEIVE_QUOTE_UPDATED',
  'SPARK_SEND_QUOTE_CREATED',
  'SPARK_SEND_QUOTE_UPDATED',
  'USER_UPDATED',
] as const;

type BroadcastName = (typeof BROADCAST_EVENTS)[number];

type Decode = (
  payload: unknown,
  ctx: RealtimeRouteContext,
) => Promise<FeedEmission>;

const decoders = {
  ACCOUNT_CREATED: async (payload, ctx) => ({
    event: 'account.created',
    payload: {
      account: await ctx.accountRepository.toAccount(
        payload as AgicashDbAccountWithProofs,
      ),
    },
  }),
  ACCOUNT_UPDATED: async (payload, ctx) => ({
    event: 'account.updated',
    payload: {
      account: await ctx.accountRepository.toAccount(
        payload as AgicashDbAccountWithProofs,
      ),
    },
  }),
  TRANSACTION_CREATED: async (payload, ctx) => ({
    event: 'transaction.created',
    payload: {
      transaction: await ctx.transactionRepository.toTransaction(
        payload as AgicashDbTransaction,
      ),
    },
  }),
  TRANSACTION_UPDATED: async (payload, ctx) => ({
    event: 'transaction.updated',
    payload: {
      transaction: await ctx.transactionRepository.toTransaction(
        payload as AgicashDbTransaction,
      ),
    },
  }),
  CASHU_RECEIVE_QUOTE_CREATED: async (payload, ctx) => ({
    event: 'cashu-receive-quote.created',
    payload: {
      quote: await ctx.cashuReceiveQuoteRepository.toQuote(
        payload as AgicashDbCashuReceiveQuote,
      ),
    },
  }),
  CASHU_RECEIVE_QUOTE_UPDATED: async (payload, ctx) => ({
    event: 'cashu-receive-quote.updated',
    payload: {
      quote: await ctx.cashuReceiveQuoteRepository.toQuote(
        payload as AgicashDbCashuReceiveQuote,
      ),
    },
  }),
  CASHU_RECEIVE_SWAP_CREATED: async (payload, ctx) => ({
    event: 'cashu-receive-swap.created',
    payload: {
      swap: await ctx.cashuReceiveSwapRepository.toReceiveSwap(
        payload as AgicashDbCashuReceiveSwap,
      ),
    },
  }),
  CASHU_RECEIVE_SWAP_UPDATED: async (payload, ctx) => ({
    event: 'cashu-receive-swap.updated',
    payload: {
      swap: await ctx.cashuReceiveSwapRepository.toReceiveSwap(
        payload as AgicashDbCashuReceiveSwap,
      ),
    },
  }),
  CASHU_SEND_QUOTE_CREATED: async (payload, ctx) => ({
    event: 'cashu-send-quote.created',
    payload: {
      quote: await ctx.cashuSendQuoteRepository.toQuote(
        payload as AgicashDbCashuSendQuote & {
          cashu_proofs: AgicashDbCashuProof[];
        },
      ),
    },
  }),
  CASHU_SEND_QUOTE_UPDATED: async (payload, ctx) => ({
    event: 'cashu-send-quote.updated',
    payload: {
      quote: await ctx.cashuSendQuoteRepository.toQuote(
        payload as AgicashDbCashuSendQuote & {
          cashu_proofs: AgicashDbCashuProof[];
        },
      ),
    },
  }),
  CASHU_SEND_SWAP_CREATED: async (payload, ctx) => ({
    event: 'cashu-send-swap.created',
    payload: {
      swap: await ctx.cashuSendSwapRepository.toSwap(
        payload as AgicashDbCashuSendSwap & {
          cashu_proofs: AgicashDbCashuProof[];
        },
      ),
    },
  }),
  CASHU_SEND_SWAP_UPDATED: async (payload, ctx) => ({
    event: 'cashu-send-swap.updated',
    payload: {
      swap: await ctx.cashuSendSwapRepository.toSwap(
        payload as AgicashDbCashuSendSwap & {
          cashu_proofs: AgicashDbCashuProof[];
        },
      ),
    },
  }),
  CONTACT_CREATED: async (payload, ctx) => ({
    event: 'contact.created',
    payload: {
      contact: ContactRepository.toContact(
        payload as AgicashDbContact,
        ctx.lightningAddressDomain,
      ),
    },
  }),
  CONTACT_DELETED: async (payload, ctx) => ({
    event: 'contact.deleted',
    payload: {
      contact: ContactRepository.toContact(
        payload as AgicashDbContact,
        ctx.lightningAddressDomain,
      ),
    },
  }),
  SPARK_RECEIVE_QUOTE_CREATED: async (payload, ctx) => ({
    event: 'spark-receive-quote.created',
    payload: {
      quote: await ctx.sparkReceiveQuoteRepository.toQuote(
        payload as AgicashDbSparkReceiveQuote,
      ),
    },
  }),
  SPARK_RECEIVE_QUOTE_UPDATED: async (payload, ctx) => ({
    event: 'spark-receive-quote.updated',
    payload: {
      quote: await ctx.sparkReceiveQuoteRepository.toQuote(
        payload as AgicashDbSparkReceiveQuote,
      ),
    },
  }),
  SPARK_SEND_QUOTE_CREATED: async (payload, ctx) => ({
    event: 'spark-send-quote.created',
    payload: {
      quote: await ctx.sparkSendQuoteRepository.toQuote(
        payload as AgicashDbSparkSendQuote,
      ),
    },
  }),
  SPARK_SEND_QUOTE_UPDATED: async (payload, ctx) => ({
    event: 'spark-send-quote.updated',
    payload: {
      quote: await ctx.sparkSendQuoteRepository.toQuote(
        payload as AgicashDbSparkSendQuote,
      ),
    },
  }),
  USER_UPDATED: async (payload) => ({
    event: 'user.updated',
    payload: {
      user: ReadUserRepository.toUser(payload as AgicashDbUser),
    },
  }),
} satisfies Record<BroadcastName, Decode>;

function isBroadcast(event: string): event is BroadcastName {
  return Object.hasOwn(decoders, event);
}

/** Maps each broadcast name to one contract emission using `ctx`'s mappers. */
export function createRoutes(ctx: RealtimeRouteContext): {
  [K in BroadcastName]: (payload: unknown) => Promise<FeedEmission>;
} {
  const routes = {} as {
    [K in BroadcastName]: (payload: unknown) => Promise<FeedEmission>;
  };
  for (const event of BROADCAST_EVENTS) {
    routes[event] = (payload) => decoders[event](payload, ctx);
  }
  return routes;
}

export type RealtimeFeedDeps = {
  transport: RealtimeTransport;
  getSession: () => AuthSession;
  db: AgicashDb;
  getEncryption: () => Promise<Encryption>;
  getAccountRepository: () => Promise<AccountRepository>;
  lightningAddressDomain: string;
  activity: ActivityMonitor;
  emit: (emission: FeedEmission) => void;
  logger: Logger;
  /** Test seam; defaults to the global timers. */
  clock?: ScopeClock;
};

export type RealtimeFeed = {
  /** Opens the channel for the live session's user; no-op when logged out, disposed, or already open for that user. */
  open(): void;
  /** Leaves the channel and fences every in-flight decode. Synchronous; idempotent. */
  close(): void;
  /** `close()`, then every later `open()` is a no-op. */
  dispose(): void;
};

const systemClock: ScopeClock = {
  setInterval(callback, ms) {
    const id = setInterval(callback, ms);
    return () => clearInterval(id);
  },
  setTimeout(callback, ms) {
    const id = setTimeout(callback, ms);
    return () => clearTimeout(id);
  },
};

type InternalState =
  | 'idle'
  | 'subscribing'
  | 'subscribed'
  | 'reconnecting'
  | 'closed'
  | 'error';

type PublicConnection = 'connected' | 'reconnecting' | 'error';

function rejectUnused(name: string): Promise<never> {
  return Promise.reject(new Error(`Unused realtime mapper: ${name}`));
}

function emptyRouteContext(domain: string): RealtimeRouteContext {
  return {
    accountRepository: { toAccount: () => rejectUnused('account') },
    transactionRepository: {
      toTransaction: () => rejectUnused('transaction'),
    },
    cashuReceiveQuoteRepository: {
      toQuote: () => rejectUnused('cashu-receive-quote'),
    },
    cashuReceiveSwapRepository: {
      toReceiveSwap: () => rejectUnused('cashu-receive-swap'),
    },
    cashuSendQuoteRepository: {
      toQuote: () => rejectUnused('cashu-send-quote'),
    },
    cashuSendSwapRepository: {
      toSwap: () => rejectUnused('cashu-send-swap'),
    },
    sparkReceiveQuoteRepository: {
      toQuote: () => rejectUnused('spark-receive-quote'),
    },
    sparkSendQuoteRepository: {
      toQuote: () => rejectUnused('spark-send-quote'),
    },
    lightningAddressDomain: domain,
  };
}

function needsAccountRepository(event: BroadcastName): boolean {
  return (
    event === 'ACCOUNT_CREATED' ||
    event === 'ACCOUNT_UPDATED' ||
    event.startsWith('CASHU_RECEIVE_')
  );
}

/**
 * One `wallet:<userId>` channel and its reconnect loop.
 *
 * `pendingLeave` is instance-wide, not per scope: realtime-js returns the
 * still-leaving channel for a topic, and `subscribe()` on it never reports a
 * status. Every join waits on that chain, including a join started by the
 * next scope.
 */
class RealtimeFeedRuntime {
  private userId: string | undefined;
  private current: RealtimeJoin | undefined;
  private state: InternalState = 'idle';
  private counter = 0;
  private inRetryCycle = false;
  private disposed = false;
  private pendingLeave: Promise<void> = Promise.resolve();
  private lastEmitted: PublicConnection | undefined;
  private readonly scopes: RunScopes;

  constructor(private readonly deps: RealtimeFeedDeps) {
    this.scopes = createRunScopes(deps.clock ?? systemClock);
  }

  open(): void {
    if (this.disposed) return;
    const session = this.deps.getSession();
    if (!session.isLoggedIn) return;
    if (this.userId === session.user.id) return;
    this.close();
    this.userId = session.user.id;
    this.counter = 0;
    this.inRetryCycle = false;
    const scope = this.scopes.renew();
    scope.onCleanup(
      this.deps.activity.subscribe(() => {
        this.onActivity(scope);
      }),
    );
    void this.subscribe(scope);
  }

  close(): void {
    this.scopes.cancel();
    this.startLeave();
    this.state = 'idle';
    this.userId = undefined;
    this.counter = 0;
    this.inRetryCycle = false;
    this.lastEmitted = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.close();
  }

  private topic(): string {
    return `wallet:${this.userId}`;
  }

  private startLeave(): void {
    const join = this.current;
    this.current = undefined;
    if (!join) return;
    const leaving = join.leave();
    this.pendingLeave = Promise.allSettled([this.pendingLeave, leaving]).then(
      () => undefined,
    );
  }

  private async subscribe(scope: RunScope): Promise<void> {
    // Before the first await: onActivity starts an attempt only from 'closed',
    // and the activity monitor can fire twice for one return to the tab.
    this.transition('subscribing');
    this.startLeave();
    await scope.track(this.pendingLeave);
    if (!scope.alive) return;
    try {
      await scope.track(this.deps.transport.refreshAuth());
    } catch (error) {
      if (!scope.alive) return;
      this.fail(scope, error);
      return;
    }
    if (!scope.alive) return;
    const userId = this.userId;
    if (userId === undefined) return;

    const slot: { handle?: RealtimeJoin } = {};
    const whenCurrent = (run: () => void) => {
      const deliver = () => {
        if (
          !scope.alive ||
          slot.handle === undefined ||
          this.current !== slot.handle
        ) {
          return;
        }
        run();
      };
      // join() can report status before it returns the handle.
      if (slot.handle === undefined) {
        queueMicrotask(deliver);
        return;
      }
      deliver();
    };
    const joined = this.deps.transport.join(`wallet:${userId}`, {
      onBroadcast: (event, payload) => {
        whenCurrent(() => {
          this.onBroadcast(scope, event, payload);
        });
      },
      onStatus: (status, error) => {
        whenCurrent(() => {
          this.onStatus(scope, status, error);
        });
      },
    });
    slot.handle = joined;
    this.current = joined;
  }

  private fail(scope: RunScope, cause: unknown): void {
    if (!scope.alive) return;
    if (!this.deps.activity.isActive() && !this.inRetryCycle) {
      this.startLeave();
      this.transition('closed');
      return;
    }
    this.inRetryCycle = true;
    void this.retry(scope, cause);
  }

  private onStatus(
    scope: RunScope,
    status: REALTIME_SUBSCRIBE_STATES,
    error?: Error,
  ): void {
    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
      this.inRetryCycle = false;
      this.counter = 0;
      this.transition('subscribed');
      return;
    }
    if (status === REALTIME_SUBSCRIBE_STATES.CLOSED) {
      this.startLeave();
      this.inRetryCycle = false;
      this.transition('closed');
      return;
    }
    if (
      status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
      status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
    ) {
      this.fail(scope, error ?? new Error(`Realtime channel ${status}`));
    }
  }

  private async retry(scope: RunScope, cause: unknown): Promise<void> {
    this.startLeave();
    if (this.counter === RETRY_DELAYS_MS.length) {
      this.inRetryCycle = false;
      this.state = 'error';
      this.deps.logger.debug('Realtime channel state changed', {
        topic: this.topic(),
        state: 'error',
      });
      this.deps.logger.error('Realtime channel failed', {
        topic: this.topic(),
        cause,
      });
      this.emitPublic('error');
      return;
    }
    this.transition('reconnecting');
    const delay = RETRY_DELAYS_MS[this.counter];
    const attempt = this.counter + 1;
    this.counter += 1;
    this.deps.logger.debug('Realtime channel scheduled resubscribe attempt', {
      topic: this.topic(),
      attempt: `${attempt}/${RETRY_DELAYS_MS.length}`,
      delay,
    });
    await scope.delay(delay);
    if (!scope.alive) return;
    void this.subscribe(scope);
  }

  private onActivity(scope: RunScope): void {
    if (!scope.alive) return;
    if (this.deps.activity.isActive() && this.state === 'closed') {
      this.counter = 0;
      void this.subscribe(scope);
    }
  }

  private onBroadcast(scope: RunScope, event: string, payload: unknown): void {
    if (!isBroadcast(event)) {
      this.deps.logger.debug('Realtime event ignored', { event });
      return;
    }
    void this.decodeAndEmit(scope, event, payload);
  }

  private async decodeAndEmit(
    scope: RunScope,
    event: BroadcastName,
    payload: unknown,
  ): Promise<void> {
    try {
      const emission = await scope.track(this.decode(scope, event, payload));
      if (!scope.alive || emission === undefined) return;
      this.deps.emit(emission);
    } catch (cause) {
      if (!scope.alive) return;
      this.deps.logger.error('Realtime event decode failed', {
        event,
        cause,
      });
    }
  }

  private async decode(
    scope: RunScope,
    event: BroadcastName,
    payload: unknown,
  ): Promise<FeedEmission | undefined> {
    const ctx = await this.routeContext(scope, event);
    if (!ctx || !scope.alive) return undefined;
    return createRoutes(ctx)[event](payload);
  }

  private async routeContext(
    scope: RunScope,
    event: BroadcastName,
  ): Promise<RealtimeRouteContext | undefined> {
    const encryption = await this.deps.getEncryption();
    if (!scope.alive) return undefined;
    const accountRepository = needsAccountRepository(event)
      ? await this.deps.getAccountRepository()
      : undefined;
    if (!scope.alive) return undefined;

    const ctx = emptyRouteContext(this.deps.lightningAddressDomain);
    const db = this.deps.db;
    switch (event) {
      case 'ACCOUNT_CREATED':
      case 'ACCOUNT_UPDATED':
        if (accountRepository) {
          ctx.accountRepository = {
            toAccount: (row) => accountRepository.toAccount(row),
          };
        }
        break;
      case 'TRANSACTION_CREATED':
      case 'TRANSACTION_UPDATED':
        ctx.transactionRepository = new TransactionRepository(db, encryption);
        break;
      case 'CASHU_RECEIVE_QUOTE_CREATED':
      case 'CASHU_RECEIVE_QUOTE_UPDATED':
        if (accountRepository) {
          ctx.cashuReceiveQuoteRepository = new CashuReceiveQuoteRepository(
            db,
            encryption,
            accountRepository,
          );
        }
        break;
      case 'CASHU_RECEIVE_SWAP_CREATED':
      case 'CASHU_RECEIVE_SWAP_UPDATED':
        if (accountRepository) {
          ctx.cashuReceiveSwapRepository = new CashuReceiveSwapRepository(
            db,
            encryption,
            accountRepository,
          );
        }
        break;
      case 'CASHU_SEND_QUOTE_CREATED':
      case 'CASHU_SEND_QUOTE_UPDATED':
        ctx.cashuSendQuoteRepository = new CashuSendQuoteRepository(
          db,
          encryption,
        );
        break;
      case 'CASHU_SEND_SWAP_CREATED':
      case 'CASHU_SEND_SWAP_UPDATED':
        ctx.cashuSendSwapRepository = new CashuSendSwapRepository(
          db,
          encryption,
        );
        break;
      case 'SPARK_RECEIVE_QUOTE_CREATED':
      case 'SPARK_RECEIVE_QUOTE_UPDATED':
        ctx.sparkReceiveQuoteRepository = new SparkReceiveQuoteRepository(
          db,
          encryption,
        );
        break;
      case 'SPARK_SEND_QUOTE_CREATED':
      case 'SPARK_SEND_QUOTE_UPDATED':
        ctx.sparkSendQuoteRepository = new SparkSendQuoteRepository(
          db,
          encryption,
        );
        break;
      case 'CONTACT_CREATED':
      case 'CONTACT_DELETED':
      case 'USER_UPDATED':
        break;
      default: {
        const unreachable: never = event;
        throw new Error(`Unhandled realtime broadcast: ${unreachable}`);
      }
    }
    return ctx;
  }

  private transition(next: InternalState): void {
    this.state = next;
    if (this.userId !== undefined) {
      this.deps.logger.debug('Realtime channel state changed', {
        topic: this.topic(),
        state: next,
      });
    }
    if (next === 'subscribed') {
      this.emitPublic('connected');
      return;
    }
    const mapped: PublicConnection | undefined =
      next === 'reconnecting' || next === 'closed'
        ? 'reconnecting'
        : next === 'error'
          ? 'error'
          : next === 'subscribing' && this.inRetryCycle
            ? 'reconnecting'
            : undefined;
    if (mapped !== undefined && mapped !== this.lastEmitted) {
      this.emitPublic(mapped);
    }
  }

  private emitPublic(state: PublicConnection): void {
    this.lastEmitted = state;
    this.deps.emit({
      event: 'connection.changed',
      payload: { state },
    });
  }
}

/**
 * Realtime change-feed for one SDK instance. The facade exposes `open`,
 * `close`, and `dispose`.
 */
export function createRealtimeFeed(deps: RealtimeFeedDeps): RealtimeFeed {
  const runtime = new RealtimeFeedRuntime(deps);
  return {
    open: () => runtime.open(),
    close: () => runtime.close(),
    dispose: () => runtime.dispose(),
  };
}
