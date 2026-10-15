import { describe, expect, it } from 'bun:test';
import {
  REALTIME_SUBSCRIBE_STATES,
  RealtimeClient,
} from '@supabase/supabase-js';
import type {
  AgicashDb,
  AgicashDbContact,
  AgicashDbUser,
} from '../../db/database';
import type { Encryption } from '../../lib/encryption';
import type { ScopeClock } from '../../lib/run-scope';
import type { Account } from '../accounts/account';
import type { AccountRepository } from '../accounts/account-repository';
import { ContactRepository } from '../contacts/contact-repository';
import type { ActivityMonitor, AuthSession, Logger } from '../sdk';
import { ReadUserRepository } from '../user/user-repository';
import {
  type FeedEmission,
  RETRY_DELAYS_MS,
  type RealtimeFeed,
  type RealtimeJoin,
  type RealtimeRouteContext,
  type RealtimeTransport,
  createRealtimeFeed,
  createRoutes,
  createSupabaseRealtimeTransport,
} from './realtime-feed';

const USER_A = 'user-a';
const USER_B = 'user-b';
const DOMAIN = 'example.test';

const loggedOut: AuthSession = { isLoggedIn: false };

function loggedIn(id: string): AuthSession {
  return { isLoggedIn: true, user: { id } } as AuthSession;
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

type RecordedTimer = {
  ms: number;
  at: number;
  callback: () => void;
  cancelled: boolean;
};

function createManualClock(): ScopeClock & {
  advance(ms: number): void;
  pending(): RecordedTimer[];
} {
  let now = 0;
  const timeouts: RecordedTimer[] = [];
  const intervals: RecordedTimer[] = [];
  const arm = (bucket: RecordedTimer[]) => {
    return (callback: () => void, ms: number) => {
      const timer: RecordedTimer = {
        ms,
        at: now + ms,
        callback,
        cancelled: false,
      };
      bucket.push(timer);
      return () => {
        timer.cancelled = true;
      };
    };
  };
  return {
    setTimeout: arm(timeouts),
    setInterval: arm(intervals),
    pending: () => timeouts.filter((timer) => !timer.cancelled),
    advance(ms) {
      if (ms < 0) return;
      const target = now + ms;
      for (;;) {
        const next = timeouts
          .filter((timer) => !timer.cancelled && timer.at <= target)
          .sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at;
        next.cancelled = true;
        next.callback();
      }
      now = target;
    },
  };
}

function createActivity(initial: boolean): {
  activity: ActivityMonitor;
  set(active: boolean): void;
  isActive(): boolean;
} {
  let active = initial;
  const listeners = new Set<() => void>();
  return {
    activity: {
      isActive: () => active,
      subscribe: (onChange) => {
        listeners.add(onChange);
        return () => {
          listeners.delete(onChange);
        };
      },
    },
    set(next) {
      active = next;
      for (const listener of [...listeners]) listener();
    },
    isActive: () => active,
  };
}

type Trace =
  | { op: 'refreshAuth' }
  | { op: 'join'; topic: string }
  | { op: 'leave'; topic: string }
  | { op: 'emit'; emission: FeedEmission };

type Listener = {
  onBroadcast(event: string, payload: unknown): void;
  onStatus(status: REALTIME_SUBSCRIBE_STATES, error?: Error): void;
};

type Handle = RealtimeJoin & {
  topic: string;
  suppressed: boolean;
  fire(status: REALTIME_SUBSCRIBE_STATES, error?: Error): void;
  broadcast(event: string, payload: unknown): void;
};

function createTransport(): RealtimeTransport & {
  trace: Trace[];
  holdLeaves: boolean;
  refreshAuthImpl: () => Promise<void>;
  resolveLeaves(): void;
  current(): Handle;
  joinCount(): number;
  leaveCount(): number;
  refreshCount(): number;
  handles: Handle[];
} {
  const trace: Trace[] = [];
  const handles: Handle[] = [];
  const releasers: Array<() => void> = [];
  const openByTopic = new Map<string, number>();
  const transport = {
    trace,
    handles,
    holdLeaves: false,
    refreshAuthImpl: async () => undefined,
    refreshAuth() {
      trace.push({ op: 'refreshAuth' });
      return transport.refreshAuthImpl();
    },
    join(topic: string, listener: Listener): Handle {
      trace.push({ op: 'join', topic });
      // realtime-js hands back the channel still registered for a topic, and
      // subscribe() on it reports nothing; a broadcast binding still lands on
      // that shared channel.
      const suppressed = (openByTopic.get(topic) ?? 0) > 0;
      if (!suppressed) {
        openByTopic.set(topic, (openByTopic.get(topic) ?? 0) + 1);
      }
      let left = false;
      let notifying = false;
      const handle: Handle = {
        topic,
        suppressed,
        fire(status, error) {
          if (suppressed) return;
          listener.onStatus(status, error);
        },
        broadcast(event, payload) {
          listener.onBroadcast(event, payload);
        },
        leave() {
          trace.push({ op: 'leave', topic });
          // realtime-js 2.95.2 reports CLOSED and unregisters the channel
          // synchronously inside unsubscribe(); only the promise is held.
          if (!suppressed && !left) {
            left = true;
            openByTopic.set(
              topic,
              Math.max(0, (openByTopic.get(topic) ?? 1) - 1),
            );
          }
          if (notifying) return Promise.resolve();
          notifying = true;
          try {
            if (!suppressed) {
              listener.onStatus(REALTIME_SUBSCRIBE_STATES.CLOSED);
            }
          } finally {
            notifying = false;
          }
          return new Promise((resolve) => {
            if (transport.holdLeaves) {
              releasers.push(resolve);
              return;
            }
            resolve();
          });
        },
      };
      handles.push(handle);
      return handle;
    },
    resolveLeaves() {
      const pending = releasers.splice(0);
      for (const release of pending) release();
    },
    current() {
      for (let index = handles.length - 1; index >= 0; index -= 1) {
        const handle = handles[index];
        if (handle && !handle.suppressed) return handle;
      }
      throw new Error('no live join');
    },
    joinCount() {
      return trace.filter((entry) => entry.op === 'join').length;
    },
    leaveCount() {
      return trace.filter((entry) => entry.op === 'leave').length;
    },
    refreshCount() {
      return trace.filter((entry) => entry.op === 'refreshAuth').length;
    },
  };
  return transport;
}

type Harness = {
  feed: RealtimeFeed;
  transport: ReturnType<typeof createTransport>;
  clock: ReturnType<typeof createManualClock>;
  activity: ReturnType<typeof createActivity>;
  emissions: FeedEmission[];
  trace: Trace[];
  debugLog: Array<{ message: string; meta: unknown }>;
  errorLog: Array<{ message: string; meta: unknown }>;
  setSession(session: AuthSession): void;
  session(): AuthSession;
  accountRepositoryRequests(): number;
};

function createHarness(options?: {
  userId?: string;
  loggedIn?: boolean;
  active?: boolean;
  domain?: string;
  toAccount?: (row: unknown) => Promise<unknown>;
  refreshAuth?: () => Promise<void>;
}): Harness {
  let session: AuthSession =
    options?.loggedIn === false
      ? loggedOut
      : loggedIn(options?.userId ?? USER_A);
  const clock = createManualClock();
  const activity = createActivity(options?.active ?? true);
  const transport = createTransport();
  if (options?.refreshAuth) {
    transport.refreshAuthImpl = options.refreshAuth;
  }
  const emissions: FeedEmission[] = [];
  const debugLog: Array<{ message: string; meta: unknown }> = [];
  const errorLog: Array<{ message: string; meta: unknown }> = [];
  const logger: Logger = {
    debug: (message, meta) => {
      debugLog.push({ message, meta });
    },
    info: () => undefined,
    warn: () => undefined,
    error: (message, meta) => {
      errorLog.push({ message, meta });
    },
  };
  const toAccount = options?.toAccount ?? (async () => ({ tag: 'account' }));
  let accountRepositoryRequests = 0;
  const feed = createRealtimeFeed({
    transport,
    getSession: () => session,
    db: {} as AgicashDb,
    getEncryption: async () => ({}) as Encryption,
    getAccountRepository: async () => {
      accountRepositoryRequests += 1;
      return { toAccount } as AccountRepository;
    },
    lightningAddressDomain: options?.domain ?? DOMAIN,
    activity: activity.activity,
    emit: (emission) => {
      emissions.push(emission);
      transport.trace.push({ op: 'emit', emission });
    },
    logger,
    clock,
  });
  return {
    feed,
    transport,
    clock,
    activity,
    emissions,
    trace: transport.trace,
    debugLog,
    errorLog,
    setSession: (next) => {
      session = next;
    },
    session: () => session,
    accountRepositoryRequests: () => accountRepositoryRequests,
  };
}

function connectionStates(
  h: Harness,
): Array<'connected' | 'reconnecting' | 'error'> {
  return h.emissions.flatMap((emission) =>
    emission.event === 'connection.changed' ? [emission.payload.state] : [],
  );
}

function domainEvents(h: Harness): FeedEmission[] {
  return h.emissions.filter(
    (emission) => emission.event !== 'connection.changed',
  );
}

async function connect(h: Harness): Promise<void> {
  h.feed.open();
  await flush();
  h.transport.current().fire(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
  await flush();
}

async function failAndStep(h: Harness, delay: number): Promise<void> {
  const joins = h.transport.joinCount();
  h.transport
    .current()
    .fire(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, new Error('down'));
  await flush();
  expect(h.transport.joinCount()).toBe(joins);
  expect(h.clock.pending().map((timer) => timer.ms)).toEqual([delay]);
  h.clock.advance(delay - 1);
  await flush();
  expect(h.transport.joinCount()).toBe(joins);
  h.clock.advance(1);
  await flush();
  expect(h.transport.joinCount()).toBe(joins + 1);
}

async function exhaust(h: Harness): Promise<void> {
  await connect(h);
  for (const delay of RETRY_DELAYS_MS) {
    await failAndStep(h, delay);
  }
  h.transport
    .current()
    .fire(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, new Error('down'));
  await flush();
}

const contactRow = {
  id: 'contact-1',
  created_at: '2020-01-01T00:00:00.000Z',
  username: 'ada',
};

const userRow = {
  id: 'user-1',
  username: 'ada',
  email: null,
};

describe('createRealtimeFeed', () => {
  it('a. open joins after auth and emits connected once', async () => {
    const h = createHarness();
    h.feed.open();
    await flush();

    expect(h.trace).toEqual([
      { op: 'refreshAuth' },
      { op: 'join', topic: `wallet:${USER_A}` },
    ]);

    h.transport.current().fire(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    await flush();

    expect(h.emissions).toEqual([
      { event: 'connection.changed', payload: { state: 'connected' } },
    ]);
  });

  it('b. maps every broadcast name to one contract emission', async () => {
    const seen = new Map<string, unknown>();
    const tag = (name: string) => {
      return async (row: unknown) => {
        seen.set(name, row);
        return { tag: name };
      };
    };
    const routes = createRoutes({
      accountRepository: { toAccount: tag('account') },
      transactionRepository: { toTransaction: tag('transaction') },
      cashuReceiveQuoteRepository: { toQuote: tag('cashu-receive-quote') },
      cashuReceiveSwapRepository: { toReceiveSwap: tag('cashu-receive-swap') },
      cashuSendQuoteRepository: { toQuote: tag('cashu-send-quote') },
      cashuSendSwapRepository: { toSwap: tag('cashu-send-swap') },
      sparkReceiveQuoteRepository: { toQuote: tag('spark-receive-quote') },
      sparkSendQuoteRepository: { toQuote: tag('spark-send-quote') },
      lightningAddressDomain: DOMAIN,
    } as unknown as RealtimeRouteContext);

    const cases: Array<{
      broadcast: keyof typeof routes;
      event: FeedEmission['event'];
      key: string;
      tag: string;
      row: unknown;
    }> = [
      {
        broadcast: 'ACCOUNT_CREATED',
        event: 'account.created',
        key: 'account',
        tag: 'account',
        row: { id: 'account-created' },
      },
      {
        broadcast: 'ACCOUNT_UPDATED',
        event: 'account.updated',
        key: 'account',
        tag: 'account',
        row: { id: 'account-updated' },
      },
      {
        broadcast: 'TRANSACTION_CREATED',
        event: 'transaction.created',
        key: 'transaction',
        tag: 'transaction',
        row: { id: 'transaction-created' },
      },
      {
        broadcast: 'TRANSACTION_UPDATED',
        event: 'transaction.updated',
        key: 'transaction',
        tag: 'transaction',
        row: {
          id: 'transaction-updated',
          previous_acknowledgment_status: 'pending',
        },
      },
      {
        broadcast: 'CASHU_RECEIVE_QUOTE_CREATED',
        event: 'cashu-receive-quote.created',
        key: 'quote',
        tag: 'cashu-receive-quote',
        row: { id: 'crq-created' },
      },
      {
        broadcast: 'CASHU_RECEIVE_QUOTE_UPDATED',
        event: 'cashu-receive-quote.updated',
        key: 'quote',
        tag: 'cashu-receive-quote',
        row: { id: 'crq-updated' },
      },
      {
        broadcast: 'CASHU_RECEIVE_SWAP_CREATED',
        event: 'cashu-receive-swap.created',
        key: 'swap',
        tag: 'cashu-receive-swap',
        row: { id: 'crs-created' },
      },
      {
        broadcast: 'CASHU_RECEIVE_SWAP_UPDATED',
        event: 'cashu-receive-swap.updated',
        key: 'swap',
        tag: 'cashu-receive-swap',
        row: { id: 'crs-updated' },
      },
      {
        broadcast: 'CASHU_SEND_QUOTE_CREATED',
        event: 'cashu-send-quote.created',
        key: 'quote',
        tag: 'cashu-send-quote',
        row: { id: 'csq-created' },
      },
      {
        broadcast: 'CASHU_SEND_QUOTE_UPDATED',
        event: 'cashu-send-quote.updated',
        key: 'quote',
        tag: 'cashu-send-quote',
        row: { id: 'csq-updated' },
      },
      {
        broadcast: 'CASHU_SEND_SWAP_CREATED',
        event: 'cashu-send-swap.created',
        key: 'swap',
        tag: 'cashu-send-swap',
        row: { id: 'css-created' },
      },
      {
        broadcast: 'CASHU_SEND_SWAP_UPDATED',
        event: 'cashu-send-swap.updated',
        key: 'swap',
        tag: 'cashu-send-swap',
        row: { id: 'css-updated' },
      },
      {
        broadcast: 'SPARK_RECEIVE_QUOTE_CREATED',
        event: 'spark-receive-quote.created',
        key: 'quote',
        tag: 'spark-receive-quote',
        row: { id: 'srq-created' },
      },
      {
        broadcast: 'SPARK_RECEIVE_QUOTE_UPDATED',
        event: 'spark-receive-quote.updated',
        key: 'quote',
        tag: 'spark-receive-quote',
        row: { id: 'srq-updated' },
      },
      {
        broadcast: 'SPARK_SEND_QUOTE_CREATED',
        event: 'spark-send-quote.created',
        key: 'quote',
        tag: 'spark-send-quote',
        row: { id: 'ssq-created' },
      },
      {
        broadcast: 'SPARK_SEND_QUOTE_UPDATED',
        event: 'spark-send-quote.updated',
        key: 'quote',
        tag: 'spark-send-quote',
        row: { id: 'ssq-updated' },
      },
    ];

    expect(Object.keys(routes)).toHaveLength(19);

    for (const row of cases) {
      const emission = await routes[row.broadcast](row.row);
      expect(emission).toEqual({
        event: row.event,
        payload: { [row.key]: { tag: row.tag } },
      } as unknown as FeedEmission);
      expect(seen.get(row.tag)).toEqual(row.row);
    }

    const updated = cases.find(
      (row) => row.broadcast === 'TRANSACTION_UPDATED',
    );
    const updatedEmission = await routes.TRANSACTION_UPDATED(
      updated?.row ?? {},
    );
    expect(JSON.stringify(updatedEmission)).not.toContain(
      'previous_acknowledgment_status',
    );
    expect(seen.get('transaction')).toEqual(updated?.row);

    const createdContact = await routes.CONTACT_CREATED(contactRow);
    const deletedContact = await routes.CONTACT_DELETED(contactRow);
    expect(createdContact).toEqual({
      event: 'contact.created',
      payload: {
        contact: ContactRepository.toContact(
          contactRow as AgicashDbContact,
          DOMAIN,
        ),
      },
    });
    expect(deletedContact).toEqual({
      event: 'contact.deleted',
      payload: {
        contact: ContactRepository.toContact(
          contactRow as AgicashDbContact,
          DOMAIN,
        ),
      },
    });
    expect(
      (deletedContact.payload as { contact: { lud16: string } }).contact.lud16,
    ).toBe(`ada@${DOMAIN}`);

    const updatedUser = await routes.USER_UPDATED(userRow);
    expect(updatedUser).toEqual({
      event: 'user.updated',
      payload: {
        user: ReadUserRepository.toUser(userRow as AgicashDbUser),
      },
    });

    const account = { tag: 'from-feed' } as unknown as Account;
    const h = createHarness({
      toAccount: async () => account,
    });
    await connect(h);
    h.transport.current().broadcast('ACCOUNT_CREATED', { id: 'row-a' });
    await flush();
    h.transport.current().broadcast('CONTACT_DELETED', contactRow);
    await flush();
    h.transport.current().broadcast('USER_UPDATED', userRow);
    await flush();
    expect(domainEvents(h)).toEqual([
      { event: 'account.created', payload: { account } },
      {
        event: 'contact.deleted',
        payload: {
          contact: ContactRepository.toContact(
            contactRow as AgicashDbContact,
            DOMAIN,
          ),
        },
      },
      {
        event: 'user.updated',
        payload: {
          user: ReadUserRepository.toUser(userRow as AgicashDbUser),
        },
      },
    ]);
  });

  it('b2. builds a mapper for every broadcast name through the feed', async () => {
    const names = [
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
    ];
    const rowFor = (name: string): unknown =>
      name.startsWith('CONTACT_')
        ? contactRow
        : name === 'USER_UPDATED'
          ? userRow
          : { id: `row-${name}` };
    const h = createHarness();
    await connect(h);

    const requestedFor: string[] = [];
    for (const name of names) {
      const before = h.accountRepositoryRequests();
      h.transport.current().broadcast(name, rowFor(name));
      await flush();
      if (h.accountRepositoryRequests() > before) requestedFor.push(name);
      expect(h.accountRepositoryRequests() - before).toBeLessThanOrEqual(1);
    }

    const failures = h.errorLog.filter(
      (entry) => entry.message === 'Realtime event decode failed',
    );
    expect(failures.length + domainEvents(h).length).toBe(names.length);
    for (const failure of failures) {
      const { cause } = failure.meta as { cause: unknown };
      const message = cause instanceof Error ? cause.message : String(cause);
      expect(message.startsWith('Unused realtime mapper')).toBe(false);
    }
    expect(requestedFor).toEqual([
      'ACCOUNT_CREATED',
      'ACCOUNT_UPDATED',
      'CASHU_RECEIVE_QUOTE_CREATED',
      'CASHU_RECEIVE_QUOTE_UPDATED',
      'CASHU_RECEIVE_SWAP_CREATED',
      'CASHU_RECEIVE_SWAP_UPDATED',
    ]);
  });

  it('c. drops an unknown broadcast and logs the event name only', async () => {
    const h = createHarness();
    await connect(h);
    h.transport.current().broadcast('FOO', { n: 1 });
    await flush();

    expect(domainEvents(h)).toEqual([]);
    expect(connectionStates(h)).toEqual(['connected']);
    const ignored = h.debugLog.filter(
      (entry) => entry.message === 'Realtime event ignored',
    );
    expect(ignored).toEqual([
      { message: 'Realtime event ignored', meta: { event: 'FOO' } },
    ]);
    expect(JSON.stringify(ignored)).not.toContain('"n"');
  });

  it('d. logs a rejecting mapper and leaves the feed state unchanged', async () => {
    const cause = new Error('decode-broke');
    let calls = 0;
    const h = createHarness({
      toAccount: () => {
        calls += 1;
        return Promise.reject(cause);
      },
    });
    await connect(h);
    const joins = h.transport.joinCount();
    const leaves = h.transport.leaveCount();
    const emissions = [...h.emissions];

    h.transport.current().broadcast('ACCOUNT_CREATED', { n: 1 });
    await flush();

    expect(calls).toBe(1);
    expect(h.errorLog).toEqual([
      {
        message: 'Realtime event decode failed',
        meta: { event: 'ACCOUNT_CREATED', cause },
      },
    ]);
    expect(h.errorLog[0]?.meta).not.toHaveProperty('payload');
    expect(JSON.stringify(h.errorLog)).not.toContain('"n"');
    expect(h.emissions).toEqual(emissions);
    expect(h.transport.joinCount()).toBe(joins);
    expect(h.transport.leaveCount()).toBe(leaves);
    expect(connectionStates(h)).toEqual(['connected']);
  });

  it('e. retries a transient error with backoff and emits connected again', async () => {
    const h = createHarness();
    await connect(h);
    h.transport
      .current()
      .fire(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, new Error('down'));
    await flush();

    expect(h.trace).toEqual([
      { op: 'refreshAuth' },
      { op: 'join', topic: `wallet:${USER_A}` },
      {
        op: 'emit',
        emission: {
          event: 'connection.changed',
          payload: { state: 'connected' },
        },
      },
      { op: 'leave', topic: `wallet:${USER_A}` },
      {
        op: 'emit',
        emission: {
          event: 'connection.changed',
          payload: { state: 'reconnecting' },
        },
      },
    ]);
    expect(h.clock.pending().map((timer) => timer.ms)).toEqual([0]);

    h.clock.advance(0);
    await flush();

    expect(h.trace.slice(5)).toEqual([
      { op: 'refreshAuth' },
      { op: 'join', topic: `wallet:${USER_A}` },
    ]);

    h.transport.current().fire(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    expect(connectionStates(h)).toEqual([
      'connected',
      'reconnecting',
      'connected',
    ]);
  });

  it('f. waits exactly the retry delay schedule', async () => {
    const h = createHarness();
    await connect(h);
    for (const delay of RETRY_DELAYS_MS) {
      await failAndStep(h, delay);
    }
    expect(h.transport.joinCount()).toBe(1 + RETRY_DELAYS_MS.length);
  });

  it('g. stops after nine failed retries and does not rejoin on activation', async () => {
    const h = createHarness();
    await exhaust(h);

    expect(h.transport.joinCount()).toBe(1 + RETRY_DELAYS_MS.length);
    expect(connectionStates(h).filter((state) => state === 'error')).toEqual([
      'error',
    ]);
    expect(h.errorLog).toHaveLength(1);
    expect(h.errorLog[0]?.message).toBe('Realtime channel failed');
    expect(h.errorLog[0]?.meta).toMatchObject({
      topic: `wallet:${USER_A}`,
    });
    expect(h.errorLog[0]?.meta).not.toHaveProperty('payload');
    expect(h.trace.at(-1)).toEqual({
      op: 'emit',
      emission: { event: 'connection.changed', payload: { state: 'error' } },
    });
    expect(h.trace.at(-2)).toEqual({ op: 'leave', topic: `wallet:${USER_A}` });
    expect(h.clock.pending()).toEqual([]);

    const joins = h.transport.joinCount();
    h.activity.set(true);
    await flush();
    expect(h.transport.joinCount()).toBe(joins);
  });

  it('h. resets the retry counter after a successful subscribe', async () => {
    const h = createHarness();
    await connect(h);
    for (let index = 0; index < 5; index += 1) {
      await failAndStep(h, RETRY_DELAYS_MS[index] ?? 0);
    }
    h.transport.current().fire(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    await flush();
    expect(
      connectionStates(h).filter((state) => state === 'connected'),
    ).toHaveLength(2);

    for (const delay of RETRY_DELAYS_MS) {
      await failAndStep(h, delay);
      expect(connectionStates(h)).not.toContain('error');
    }
    h.transport
      .current()
      .fire(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, new Error('down'));
    await flush();
    expect(connectionStates(h).filter((state) => state === 'error')).toEqual([
      'error',
    ]);
  });

  it('i. closes without retrying when inactive and no cycle is in progress', async () => {
    const h = createHarness();
    await connect(h);
    const leaves = h.transport.leaveCount();
    const joins = h.transport.joinCount();
    h.activity.set(false);
    expect(h.transport.leaveCount()).toBe(leaves);
    expect(h.emissions).toHaveLength(1);

    h.transport
      .current()
      .fire(REALTIME_SUBSCRIBE_STATES.TIMED_OUT, new Error('down'));
    await flush();

    expect(h.transport.leaveCount()).toBe(leaves + 1);
    expect(connectionStates(h)).toEqual(['connected', 'reconnecting']);
    expect(h.clock.pending()).toEqual([]);
    expect(h.transport.joinCount()).toBe(joins);

    h.activity.set(true);
    await flush();
    expect(h.transport.joinCount()).toBe(joins + 1);
    await failAndStep(h, RETRY_DELAYS_MS[0] ?? 0);
    await failAndStep(h, RETRY_DELAYS_MS[1] ?? 0);
    h.transport.current().fire(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    await flush();
    expect(connectionStates(h).at(-1)).toBe('connected');

    h.transport
      .current()
      .fire(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, new Error('down'));
    await flush();
    expect(h.clock.pending().map((timer) => timer.ms)).toEqual([
      RETRY_DELAYS_MS[0],
    ]);
    expect(connectionStates(h)).not.toContain('error');
  });

  it('i2. ends a retry cycle on SUBSCRIBED and on CLOSED', async () => {
    const subscribed = createHarness();
    await connect(subscribed);
    subscribed.transport
      .current()
      .fire(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, new Error('down'));
    await flush();
    subscribed.clock.advance(0);
    await flush();
    subscribed.transport.current().fire(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    await flush();
    subscribed.activity.set(false);
    const leaves = subscribed.transport.leaveCount();
    const joins = subscribed.transport.joinCount();
    subscribed.transport
      .current()
      .fire(REALTIME_SUBSCRIBE_STATES.TIMED_OUT, new Error('down'));
    await flush();
    expect(subscribed.transport.leaveCount()).toBe(leaves + 1);
    expect(subscribed.clock.pending()).toEqual([]);
    expect(subscribed.transport.joinCount()).toBe(joins);
    expect(connectionStates(subscribed).at(-1)).toBe('reconnecting');

    const closed = createHarness();
    await connect(closed);
    closed.transport
      .current()
      .fire(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, new Error('down'));
    await flush();
    closed.clock.advance(0);
    await flush();
    closed.transport.current().fire(REALTIME_SUBSCRIBE_STATES.CLOSED);
    await flush();
    expect(closed.clock.pending()).toEqual([]);
    closed.activity.set(true);
    await flush();
    const closedJoins = closed.transport.joinCount();
    expect(closedJoins).toBe(3);
    closed.activity.set(false);
    const closedLeaves = closed.transport.leaveCount();
    closed.transport
      .current()
      .fire(REALTIME_SUBSCRIBE_STATES.TIMED_OUT, new Error('down'));
    await flush();
    expect(closed.transport.leaveCount()).toBe(closedLeaves + 1);
    expect(closed.clock.pending()).toEqual([]);
    expect(closed.transport.joinCount()).toBe(closedJoins);
    expect(connectionStates(closed).at(-1)).toBe('reconnecting');
  });

  it('j. keeps a started retry cycle running while inactive until the budget is exhausted', async () => {
    const h = createHarness();
    await connect(h);
    h.transport
      .current()
      .fire(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, new Error('down'));
    await flush();
    expect(h.clock.pending().map((timer) => timer.ms)).toEqual([
      RETRY_DELAYS_MS[0],
    ]);
    const timer = h.clock.pending()[0];
    h.activity.set(false);
    expect(timer?.cancelled).toBe(false);
    expect(h.activity.isActive()).toBe(false);

    h.clock.advance(0);
    await flush();
    expect(h.activity.isActive()).toBe(false);
    expect(h.transport.joinCount()).toBe(2);
    expect(h.trace.at(-2)).toEqual({ op: 'refreshAuth' });
    expect(h.trace.at(-1)).toEqual({ op: 'join', topic: `wallet:${USER_A}` });

    for (let index = 1; index < RETRY_DELAYS_MS.length; index += 1) {
      const delay = RETRY_DELAYS_MS[index] ?? 0;
      const joins = h.transport.joinCount();
      h.transport
        .current()
        .fire(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, new Error('down'));
      await flush();
      expect(connectionStates(h)).not.toContain('error');
      expect(h.clock.pending().map((pending) => pending.ms)).toEqual([delay]);
      h.clock.advance(delay - 1);
      await flush();
      expect(h.transport.joinCount()).toBe(joins);
      h.clock.advance(1);
      await flush();
      expect(h.transport.joinCount()).toBe(joins + 1);
    }

    const joins = h.transport.joinCount();
    const leaves = h.transport.leaveCount();
    h.transport
      .current()
      .fire(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, new Error('down'));
    await flush();
    expect(connectionStates(h).filter((state) => state === 'error')).toEqual([
      'error',
    ]);
    expect(h.transport.joinCount()).toBe(joins);
    expect(h.transport.leaveCount()).toBe(leaves + 1);
    expect(h.trace.at(-2)).toEqual({ op: 'leave', topic: `wallet:${USER_A}` });
    expect(h.clock.pending()).toEqual([]);

    h.activity.set(true);
    await flush();
    expect(h.transport.joinCount()).toBe(joins);
  });

  it('k. stays subscribed when the tab goes inactive without an error', async () => {
    const h = createHarness();
    await connect(h);
    const joins = h.transport.joinCount();
    const leaves = h.transport.leaveCount();
    const emissions = [...h.emissions];

    h.activity.set(false);
    await flush();

    expect(h.transport.joinCount()).toBe(joins);
    expect(h.transport.leaveCount()).toBe(leaves);
    expect(h.emissions).toEqual(emissions);
  });

  it('l. treats CLOSED as closed and rejoins when activity returns', async () => {
    const h = createHarness();
    await connect(h);
    h.transport.current().fire(REALTIME_SUBSCRIBE_STATES.CLOSED);
    await flush();

    expect(h.transport.leaveCount()).toBe(1);
    expect(connectionStates(h)).toEqual(['connected', 'reconnecting']);
    expect(h.clock.pending()).toEqual([]);

    h.activity.set(true);
    await flush();
    expect(h.transport.joinCount()).toBe(2);
    expect(h.trace.at(-1)).toEqual({ op: 'join', topic: `wallet:${USER_A}` });
  });

  it('m. fences an in-flight decode on close and ignores the old join', async () => {
    let called = false;
    let resolveDecode: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => {
      resolveDecode = resolve;
    });
    const h = createHarness({
      toAccount: () => {
        called = true;
        return pending;
      },
    });
    await connect(h);
    const old = h.transport.current();
    h.transport.current().broadcast('ACCOUNT_CREATED', { n: 1 });
    await flush();
    expect(called).toBe(true);

    const emissions = h.emissions.length;
    const joins = h.transport.joinCount();
    h.feed.close();
    expect(h.transport.leaveCount()).toBe(1);

    old.fire(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    old.fire(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, new Error('down'));
    old.fire(REALTIME_SUBSCRIBE_STATES.TIMED_OUT, new Error('down'));
    old.broadcast('ACCOUNT_UPDATED', { n: 2 });
    await flush();
    resolveDecode({ tag: 'late-account' });
    await flush();

    expect(h.emissions).toHaveLength(emissions);
    expect(h.transport.joinCount()).toBe(joins);
    expect(JSON.stringify(h.emissions)).not.toContain('late-account');
    expect(domainEvents(h)).toEqual([]);
  });

  it('n. drops a decode from the previous user after an identity change', async () => {
    let called = false;
    let resolveDecode: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => {
      resolveDecode = resolve;
    });
    const h = createHarness({
      userId: USER_A,
      toAccount: () => {
        called = true;
        return pending;
      },
    });
    await connect(h);
    h.transport.current().broadcast('ACCOUNT_CREATED', { n: 1 });
    await flush();
    expect(called).toBe(true);

    h.feed.close();
    h.setSession(loggedIn(USER_B));
    h.feed.open();
    await flush();

    expect(h.trace.filter((entry) => entry.op === 'join').at(-1)).toEqual({
      op: 'join',
      topic: `wallet:${USER_B}`,
    });
    h.transport.current().fire(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    expect(connectionStates(h).at(-1)).toBe('connected');

    resolveDecode({ tag: 'from-a' });
    await flush();

    expect(domainEvents(h)).toEqual([]);
    expect(JSON.stringify(h.emissions)).not.toContain('from-a');
    expect(
      connectionStates(h).filter((state) => state === 'connected'),
    ).toEqual(['connected', 'connected']);
  });

  it('o. ignores a repeat open, a logged-out open, and a second close', async () => {
    const connected = createHarness();
    await connect(connected);
    const joins = connected.transport.joinCount();
    const auths = connected.transport.refreshCount();
    connected.feed.open();
    await flush();
    expect(connected.transport.joinCount()).toBe(joins);
    expect(connected.transport.refreshCount()).toBe(auths);

    const failed = createHarness();
    await exhaust(failed);
    const failedJoins = failed.transport.joinCount();
    failed.feed.open();
    await flush();
    expect(failed.transport.joinCount()).toBe(failedJoins);

    const signedOut = createHarness({ loggedIn: false });
    signedOut.feed.open();
    await flush();
    expect(signedOut.transport.joinCount()).toBe(0);
    expect(signedOut.trace).toEqual([]);

    const disposed = createHarness();
    disposed.feed.dispose();
    disposed.feed.open();
    await flush();
    expect(disposed.transport.joinCount()).toBe(0);

    const closed = createHarness();
    await connect(closed);
    expect(() => {
      closed.feed.close();
      closed.feed.close();
    }).not.toThrow();
    expect(closed.transport.leaveCount()).toBe(1);
    expect(closed.transport.joinCount()).toBe(1);
  });

  it('o2. does not join when a late open finds a logged-out or disposed feed', async () => {
    const h = createHarness();
    await connect(h);
    const joins = h.transport.joinCount();
    h.setSession(loggedOut);
    h.feed.open();
    await flush();
    expect(h.transport.joinCount()).toBe(joins);
    expect(h.transport.refreshCount()).toBe(1);

    const disposed = createHarness();
    await connect(disposed);
    expect(disposed.session().isLoggedIn).toBe(true);
    disposed.feed.dispose();
    expect(disposed.session().isLoggedIn).toBe(true);
    const disposedJoins = disposed.transport.joinCount();
    disposed.feed.open();
    await flush();
    expect(disposed.transport.joinCount()).toBe(disposedJoins);
  });

  it('p. treats a refreshAuth rejection as a retryable failure', async () => {
    let calls = 0;
    const h = createHarness({
      refreshAuth: async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('auth down');
        }
      },
    });
    h.feed.open();
    await flush();

    expect(connectionStates(h)).toEqual(['reconnecting']);
    expect(h.transport.joinCount()).toBe(0);
    expect(h.clock.pending().map((timer) => timer.ms)).toEqual([
      RETRY_DELAYS_MS[0],
    ]);

    h.clock.advance(0);
    await flush();
    expect(calls).toBe(2);
    expect(h.trace.filter((entry) => entry.op === 'join')).toEqual([
      { op: 'join', topic: `wallet:${USER_A}` },
    ]);
  });

  it('v. waits for a pending leave before the next join on the same scope', async () => {
    const h = createHarness();
    h.transport.holdLeaves = true;
    await connect(h);
    const old = h.transport.current();
    old.fire(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, new Error('down'));
    await flush();
    expect(h.clock.pending().map((timer) => timer.ms)).toEqual([0]);

    h.clock.advance(0);
    await flush();
    expect(h.transport.joinCount()).toBe(1);
    expect(h.transport.refreshCount()).toBe(1);

    old.fire(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    old.broadcast('ACCOUNT_CREATED', { n: 1 });
    await flush();
    expect(domainEvents(h)).toEqual([]);
    expect(
      connectionStates(h).filter((state) => state === 'connected'),
    ).toEqual(['connected']);

    const marker = h.trace.length;
    h.transport.resolveLeaves();
    await flush();
    expect(h.trace.slice(marker)).toEqual([
      { op: 'refreshAuth' },
      { op: 'join', topic: `wallet:${USER_A}` },
    ]);
    h.transport.current().fire(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    expect(
      connectionStates(h).filter((state) => state === 'connected'),
    ).toEqual(['connected', 'connected']);
    expect(h.transport.handles.every((handle) => !handle.suppressed)).toBe(
      true,
    );
  });

  it('w. waits for a pending leave across close and open, including a new user', async () => {
    const same = createHarness({ userId: USER_A });
    same.transport.holdLeaves = true;
    await connect(same);
    same.feed.close();
    same.feed.open();
    await flush();
    expect(same.transport.joinCount()).toBe(1);
    expect(same.transport.refreshCount()).toBe(1);

    same.transport.resolveLeaves();
    await flush();
    expect(same.trace.filter((entry) => entry.op === 'join').at(-1)).toEqual({
      op: 'join',
      topic: `wallet:${USER_A}`,
    });
    same.transport.current().fire(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    expect(
      connectionStates(same).filter((state) => state === 'connected'),
    ).toEqual(['connected', 'connected']);

    const switched = createHarness({ userId: USER_A });
    switched.transport.holdLeaves = true;
    await connect(switched);
    const old = switched.transport.current();
    switched.feed.close();
    switched.setSession(loggedIn(USER_B));
    switched.feed.open();
    await flush();
    expect(switched.transport.joinCount()).toBe(1);

    const emissions = switched.emissions.length;
    old.fire(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    old.fire(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, new Error('down'));
    old.broadcast('ACCOUNT_CREATED', { n: 1 });
    await flush();
    expect(switched.emissions).toHaveLength(emissions);
    expect(switched.transport.joinCount()).toBe(1);

    switched.transport.resolveLeaves();
    await flush();
    expect(
      switched.trace.filter((entry) => entry.op === 'join').at(-1),
    ).toEqual({
      op: 'join',
      topic: `wallet:${USER_B}`,
    });
    switched.transport.current().fire(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    expect(connectionStates(switched).at(-1)).toBe('connected');

    old.fire(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    old.broadcast('ACCOUNT_CREATED', { n: 2 });
    await flush();
    expect(domainEvents(switched)).toEqual([]);
    expect(
      connectionStates(switched).filter((state) => state === 'connected'),
    ).toEqual(['connected', 'connected']);
    for (const harness of [same, switched]) {
      expect(
        harness.transport.handles.every((handle) => !handle.suppressed),
      ).toBe(true);
    }
  });

  it('x. starts one join when two activity changes arrive while closed', async () => {
    const h = createHarness();
    await connect(h);
    h.activity.set(false);
    h.transport.current().fire(REALTIME_SUBSCRIBE_STATES.TIMED_OUT);
    await flush();
    const joins = h.transport.joinCount();

    h.activity.set(true);
    h.activity.set(true);
    await flush();

    expect(h.transport.joinCount()).toBe(joins + 1);
    h.transport.current().fire(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    await flush();
    expect(connectionStates(h)).toEqual([
      'connected',
      'reconnecting',
      'connected',
    ]);
    expect(h.transport.handles.every((handle) => !handle.suppressed)).toBe(
      true,
    );
  });
});

type Frame = [string | null, string | null, string, string, unknown];

function createFakeWebSocket() {
  const sockets: FakeWebSocket[] = [];
  class FakeWebSocket {
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readonly protocol = '';
    readonly url: string;
    readyState = 0;
    binaryType = 'arraybuffer';
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    readonly sent: Frame[] = [];
    addEventListener = (): void => undefined;
    removeEventListener = (): void => undefined;

    constructor(address: string | URL) {
      this.url = String(address);
      sockets.push(this);
      setTimeout(() => {
        if (this.readyState !== this.CONNECTING) return;
        this.readyState = this.OPEN;
        this.onopen?.({});
      }, 0);
    }

    send(data: string): void {
      const frame = JSON.parse(data) as Frame;
      this.sent.push(frame);
      const [joinRef, ref, topic, event] = frame;
      if (event === 'phx_join') {
        setTimeout(() => {
          this.receive([
            joinRef,
            ref,
            topic,
            'phx_reply',
            { status: 'ok', response: {} },
          ]);
        }, 0);
      }
    }

    receive(frame: Frame): void {
      if (this.readyState !== this.OPEN) return;
      this.onmessage?.({ data: JSON.stringify(frame) });
    }

    close(): void {
      this.readyState = this.CLOSED;
    }
  }
  return { FakeWebSocket, sockets };
}

function createRealtimeClient() {
  const { FakeWebSocket, sockets } = createFakeWebSocket();
  const client = new RealtimeClient('ws://x', {
    params: { apikey: 'k' },
    transport: FakeWebSocket,
    timeout: 1000,
  });
  return { client, sockets };
}

async function waitFor(condition: () => boolean, ms = 500): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe('createSupabaseRealtimeTransport', () => {
  it('joins a private channel, leaves it synchronously, and rejoins on a new channel', async () => {
    const { client } = createRealtimeClient();
    const transport = createSupabaseRealtimeTransport(
      client,
      async () => 'session-jwt',
    );
    const statuses: REALTIME_SUBSCRIBE_STATES[] = [];
    const listener = {
      onBroadcast: () => undefined,
      onStatus: (status: REALTIME_SUBSCRIBE_STATES) => {
        statuses.push(status);
      },
    };

    const first = transport.join('wallet:x', listener);
    expect(client.channels.map((channel) => channel.topic)).toEqual([
      'realtime:wallet:x',
    ]);
    const channel = client.channels[0];
    expect(channel?.private).toBe(true);
    await waitFor(() =>
      statuses.includes(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED),
    );

    const leaving = first.leave();
    expect(statuses.at(-1)).toBe(REALTIME_SUBSCRIBE_STATES.CLOSED);
    expect(client.channels).toEqual([]);
    await leaving;

    const second = transport.join('wallet:x', listener);
    expect(client.channels).toHaveLength(1);
    expect(client.channels[0]).not.toBe(channel);
    await second.leave();
    expect(client.channels).toEqual([]);
  });

  it('subscribes on a new socket well before the join timeout after a channel error', async () => {
    const { client, sockets } = createRealtimeClient();
    const states: string[] = [];
    const feed = createRealtimeFeed({
      transport: createSupabaseRealtimeTransport(
        client,
        async () => 'session-jwt',
      ),
      getSession: () => loggedIn(USER_A),
      db: {} as AgicashDb,
      getEncryption: async () => ({}) as Encryption,
      getAccountRepository: async () => ({}) as AccountRepository,
      lightningAddressDomain: DOMAIN,
      activity: createActivity(true).activity,
      emit: (emission) => {
        if (emission.event === 'connection.changed') {
          states.push(emission.payload.state);
        }
      },
      logger: silentLogger,
    });

    feed.open();
    await waitFor(() => states.includes('connected'));
    const socket = sockets[0];
    const join = socket?.sent.find((frame) => frame[3] === 'phx_join');
    if (!socket || !join) throw new Error('no join on the first socket');

    const started = Date.now();
    socket.receive([join[0], null, join[2], 'phx_error', {}]);
    await waitFor(
      () => states.filter((state) => state === 'connected').length === 2,
      900,
    );

    expect(Date.now() - started).toBeLessThan(500);
    expect(states).toEqual(['connected', 'reconnecting', 'connected']);
    expect(sockets).toHaveLength(2);
    expect(
      sockets[1]?.sent.filter((frame) => frame[3] === 'phx_join'),
    ).toHaveLength(1);

    feed.dispose();
    await waitFor(
      () => client.channels.length === 0 && !client.isDisconnecting(),
    );
  });

  it('rejects refreshAuth when the session token is missing or fails', async () => {
    const { client } = createRealtimeClient();
    await expect(
      createSupabaseRealtimeTransport(client, async () => null).refreshAuth(),
    ).rejects.toThrow('No session token');
    await expect(
      createSupabaseRealtimeTransport(client, () =>
        Promise.reject(new Error('mint failed')),
      ).refreshAuth(),
    ).rejects.toThrow('mint failed');
    await expect(
      createSupabaseRealtimeTransport(
        client,
        async () => 'session-jwt',
      ).refreshAuth(),
    ).resolves.toBeUndefined();
  });
});
