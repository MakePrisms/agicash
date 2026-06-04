/**
 * Background processor tests — Slice 5 / PR7 (the autonomous-runtime capstone).
 *
 * Fakes every collaborator (leader election, realtime hub, orchestrator, the three always-on event
 * forwarders, the two spark substrates, the six quote/swap repos, and the SDK-internal QueryClient)
 * and asserts the engine's behaviour:
 *  - lifecycle state machine: stopped → starting → follower/leader → stopping → stopped, each
 *    emitting `background:state` AND writing the `['background:state']` Query (the reactive net-new);
 *  - `start()` subscribes the realtime channel + starts lead-polling;
 *  - becoming LEADER runs the resume sweep: it reads each repo's unresolved/pending rows FROM THE
 *    DB and drives each via the orchestrator's kickoff (and is INERT as a follower);
 *  - `dispatch` routes account/transaction/contact realtime changes to their forwarders ALWAYS, and
 *    quote/swap changes to the orchestrator ONLY while leader;
 *  - THE REACTIVE BACKSTOP: each broadcast invalidates the matching memoised `Query` key(s)
 *    (account/transaction/contact/cashu/spark/user), ALWAYS + regardless of leadership;
 *  - `reconcile` (the no-cache onConnected) re-sweeps only while leader, and invalidates the
 *    read-model keys (the reactive invalidate-all);
 *  - `stop()` tears down lead-polling + realtime + the spark substrates.
 */
import { describe, expect, mock, test } from 'bun:test';
import type { QueryClient } from '../query';
import type { SparkAccount } from '../types/account';
import type { BackgroundState, SdkEventMap } from '../types/events';
import {
  BackgroundProcessor,
  type BackgroundProcessorDeps,
} from './background-processor';
import { TypedEventEmitter } from './event-emitter';

/** A fake QueryClient capturing the `invalidateQueries` keys + `setQueryData` writes. */
function fakeQueryClient() {
  const invalidated: unknown[][] = [];
  const setData: { key: unknown[]; data: unknown }[] = [];
  const client = {
    invalidateQueries: mock(async (filters: { queryKey: unknown[] }) => {
      invalidated.push(filters.queryKey);
    }),
    setQueryData: mock((key: unknown[], data: unknown) => {
      setData.push({ key, data });
    }),
  } as unknown as QueryClient;
  return {
    client,
    invalidated,
    setData,
    /** Did any invalidate call use EXACTLY this key (by JSON identity)? */
    invalidatedKey: (key: unknown[]) =>
      invalidated.some((k) => JSON.stringify(k) === JSON.stringify(key)),
  };
}

/** Build a processor over fakes; `opts` seeds what the repos return + the resolved user id. */
function makeProcessor(
  opts: {
    userId?: string | null;
    cashuSendQuotes?: unknown[];
    cashuSendSwaps?: unknown[];
    cashuReceiveQuotes?: unknown[];
    cashuReceiveSwaps?: unknown[];
    sparkSendQuotes?: unknown[];
    sparkReceiveQuotes?: unknown[];
    accounts?: unknown[];
  } = {},
) {
  const events = new TypedEventEmitter<SdkEventMap>();
  const states: BackgroundState[] = [];
  events.on('background:state', (e) => states.push(e.state));
  const qc = fakeQueryClient();

  const orchestrator = {
    executeCashuSendQuote: mock(async () => undefined),
    executeCashuSendSwap: mock(async () => undefined),
    startCashuReceiveQuote: mock(async () => undefined),
    startCashuTokenReceiveQuote: mock(async () => undefined),
    stepCashuReceiveSwap: mock(async () => undefined),
    executeSparkSendQuote: mock(async () => undefined),
    startSparkTokenReceiveQuote: mock(async () => undefined),
  };
  const leaderElection = {
    start: mock(() => undefined),
    stop: mock(() => undefined),
  };
  const realtimeHub = {
    subscribe: mock(() => undefined),
    stop: mock(async () => undefined),
  };
  const accountEventForwarder = { handleChange: mock(async () => undefined) };
  const transactionEventForwarder = {
    handleChange: mock(async () => undefined),
  };
  const contactEventForwarder = { handleChange: mock(() => undefined) };
  const sparkBalanceTracker = {
    track: mock(() => undefined),
    stop: mock(() => undefined),
  };
  const sparkEventForwarder = {
    track: mock(() => undefined),
    stop: mock(() => undefined),
  };

  const repo = (rows: unknown[], method: 'getUnresolved' | 'getPending') =>
    ({ [method]: mock(async () => rows) }) as Record<string, unknown>;

  const deps = {
    events,
    client: qc.client,
    getUserId: async () => (opts.userId === undefined ? 'user-1' : opts.userId),
    leaderElection,
    realtimeHub,
    orchestrator,
    accountEventForwarder,
    transactionEventForwarder,
    contactEventForwarder,
    sparkBalanceTracker,
    sparkEventForwarder,
    accounts: {
      getAllActive: mock(async () => opts.accounts ?? []),
    },
    cashuSendQuoteRepository: repo(opts.cashuSendQuotes ?? [], 'getUnresolved'),
    cashuSendSwapRepository: repo(opts.cashuSendSwaps ?? [], 'getUnresolved'),
    cashuReceiveQuoteRepository: repo(
      opts.cashuReceiveQuotes ?? [],
      'getPending',
    ),
    cashuReceiveSwapRepository: repo(
      opts.cashuReceiveSwaps ?? [],
      'getPending',
    ),
    sparkSendQuoteRepository: repo(opts.sparkSendQuotes ?? [], 'getUnresolved'),
    sparkReceiveQuoteRepository: repo(
      opts.sparkReceiveQuotes ?? [],
      'getPending',
    ),
  } as unknown as BackgroundProcessorDeps;

  const processor = new BackgroundProcessor(deps);
  return {
    processor,
    states,
    qc,
    orchestrator,
    leaderElection,
    realtimeHub,
    accountEventForwarder,
    transactionEventForwarder,
    contactEventForwarder,
    sparkBalanceTracker,
    sparkEventForwarder,
  };
}

const sparkAccount = (id: string, isOnline = true): SparkAccount =>
  ({ id, type: 'spark', isOnline, currency: 'BTC' }) as unknown as SparkAccount;

describe('BackgroundProcessor lifecycle', () => {
  test('start() goes stopped → starting, subscribes realtime, and starts lead-polling', async () => {
    const t = makeProcessor();
    expect(t.processor.state()).toBe('stopped');

    await t.processor.start();

    expect(t.processor.state()).toBe('starting');
    expect(t.states).toEqual(['starting']);
    expect(t.realtimeHub.subscribe).toHaveBeenCalledTimes(1);
    expect(t.leaderElection.start).toHaveBeenCalledTimes(1);
  });

  test('a state transition writes the ["background:state"] Query (reactive net-new)', async () => {
    const t = makeProcessor();
    await t.processor.start();

    // starting was written; becoming leader writes "leader".
    await t.processor.onLeadChange('leader');

    expect(
      t.qc.setData.filter(
        (s) => JSON.stringify(s.key) === JSON.stringify(['background:state']),
      ),
    ).toEqual([
      { key: ['background:state'], data: 'starting' },
      { key: ['background:state'], data: 'leader' },
    ]);
  });

  test('start() is idempotent (a second start does nothing)', async () => {
    const t = makeProcessor();
    await t.processor.start();
    await t.processor.start();
    expect(t.leaderElection.start).toHaveBeenCalledTimes(1);
  });

  test('becoming leader emits background:state "leader"; follower emits "follower"', async () => {
    const t = makeProcessor();
    await t.processor.start();

    await t.processor.onLeadChange('follower');
    expect(t.processor.state()).toBe('follower');

    await t.processor.onLeadChange('leader');
    expect(t.processor.state()).toBe('leader');

    expect(t.states).toEqual(['starting', 'follower', 'leader']);
  });

  test('stop() goes → stopping → stopped and tears down lead-polling + realtime + spark', async () => {
    const t = makeProcessor();
    await t.processor.start();
    await t.processor.onLeadChange('leader');
    t.states.length = 0;

    await t.processor.stop();

    expect(t.processor.state()).toBe('stopped');
    expect(t.states).toEqual(['stopping', 'stopped']);
    expect(t.leaderElection.stop).toHaveBeenCalledTimes(1);
    expect(t.realtimeHub.stop).toHaveBeenCalledTimes(1);
    expect(t.sparkBalanceTracker.stop).toHaveBeenCalledTimes(1);
    expect(t.sparkEventForwarder.stop).toHaveBeenCalledTimes(1);
  });

  test('stop() while stopped is a no-op', async () => {
    const t = makeProcessor();
    await t.processor.stop();
    expect(t.leaderElection.stop).toHaveBeenCalledTimes(0);
  });

  test('a lead change after stop is ignored (no state thrash)', async () => {
    const t = makeProcessor();
    await t.processor.start();
    await t.processor.stop();
    t.states.length = 0;

    await t.processor.onLeadChange('leader');

    expect(t.processor.state()).toBe('stopped');
    expect(t.states).toEqual([]);
  });
});

describe('BackgroundProcessor resume sweep (leader)', () => {
  test('drives every unresolved/pending item through the orchestrator when it becomes leader', async () => {
    const t = makeProcessor({
      cashuSendQuotes: [{ id: 'csq' }],
      cashuSendSwaps: [{ id: 'css' }],
      cashuReceiveQuotes: [{ id: 'crq', type: 'LIGHTNING' }],
      cashuReceiveSwaps: [{ id: 'crs', tokenHash: 'hash' }],
      sparkSendQuotes: [{ id: 'ssq' }],
      sparkReceiveQuotes: [{ id: 'srq', type: 'CASHU_TOKEN' }],
      accounts: [sparkAccount('spark-1')],
    });
    await t.processor.start();
    await t.processor.onLeadChange('leader');

    expect(t.orchestrator.executeCashuSendQuote).toHaveBeenCalledTimes(1);
    expect(t.orchestrator.executeCashuSendSwap).toHaveBeenCalledTimes(1);
    expect(t.orchestrator.startCashuReceiveQuote).toHaveBeenCalledTimes(1);
    expect(t.orchestrator.stepCashuReceiveSwap).toHaveBeenCalledWith(
      'hash',
      'user-1',
    );
    expect(t.orchestrator.executeSparkSendQuote).toHaveBeenCalledTimes(1);
    expect(t.orchestrator.startSparkTokenReceiveQuote).toHaveBeenCalledTimes(1);
    // online spark account is handed to both spark substrates.
    expect(t.sparkBalanceTracker.track).toHaveBeenCalledTimes(1);
    expect(t.sparkEventForwarder.track).toHaveBeenCalledTimes(1);
  });

  test('routes a cashu receive quote by type (CASHU_TOKEN → token kickoff)', async () => {
    const t = makeProcessor({
      cashuReceiveQuotes: [{ id: 'crq', type: 'CASHU_TOKEN' }],
    });
    await t.processor.start();
    await t.processor.onLeadChange('leader');

    expect(t.orchestrator.startCashuTokenReceiveQuote).toHaveBeenCalledTimes(1);
    expect(t.orchestrator.startCashuReceiveQuote).toHaveBeenCalledTimes(0);
  });

  test('is INERT as a follower — no resume sweep, no orchestrator drive', async () => {
    const t = makeProcessor({
      cashuSendQuotes: [{ id: 'csq' }],
      sparkSendQuotes: [{ id: 'ssq' }],
    });
    await t.processor.start();
    await t.processor.onLeadChange('follower');

    expect(t.orchestrator.executeCashuSendQuote).toHaveBeenCalledTimes(0);
    expect(t.orchestrator.executeSparkSendQuote).toHaveBeenCalledTimes(0);
    // and a follower transition stops the spark substrates (we no longer drive).
    expect(t.sparkBalanceTracker.stop).toHaveBeenCalledTimes(1);
    expect(t.sparkEventForwarder.stop).toHaveBeenCalledTimes(1);
  });

  test('one failing kickoff does not abort the sweep (others still run)', async () => {
    const warn = mock(() => undefined);
    const original = console.warn;
    console.warn = warn;
    try {
      const t = makeProcessor({
        cashuSendQuotes: [{ id: 'csq' }],
        sparkSendQuotes: [{ id: 'ssq' }],
      });
      t.orchestrator.executeCashuSendQuote.mockImplementationOnce(async () => {
        throw new Error('mint down');
      });
      await t.processor.start();
      await t.processor.onLeadChange('leader');

      // the spark send kickoff still ran despite the cashu one throwing.
      expect(t.orchestrator.executeSparkSendQuote).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalled();
    } finally {
      console.warn = original;
    }
  });
});

describe('BackgroundProcessor realtime dispatch', () => {
  test('account/transaction/contact changes forward ALWAYS (even as a follower)', async () => {
    const t = makeProcessor();
    await t.processor.start();
    await t.processor.onLeadChange('follower');

    t.processor.dispatch('ACCOUNT_UPDATED', { id: 'a' });
    t.processor.dispatch('TRANSACTION_CREATED', { id: 't' });
    t.processor.dispatch('CONTACT_DELETED', { id: 'c' });

    expect(t.accountEventForwarder.handleChange).toHaveBeenCalledTimes(1);
    expect(t.transactionEventForwarder.handleChange).toHaveBeenCalledTimes(1);
    expect(t.contactEventForwarder.handleChange).toHaveBeenCalledTimes(1);
  });

  test('quote/swap changes drive the orchestrator only while LEADER', async () => {
    const t = makeProcessor({ cashuSendQuotes: [{ id: 'csq' }] });
    await t.processor.start();
    await t.processor.onLeadChange('follower');

    // follower: ignored
    t.processor.dispatch('CASHU_SEND_QUOTE_UPDATED', { id: 'x' });
    await Promise.resolve();
    expect(t.orchestrator.executeCashuSendQuote).toHaveBeenCalledTimes(0);

    // leader: routed (re-sweeps the affected protocol's pending work)
    await t.processor.onLeadChange('leader');
    t.orchestrator.executeCashuSendQuote.mockClear();
    t.processor.dispatch('CASHU_SEND_QUOTE_UPDATED', { id: 'x' });
    await new Promise((r) => setTimeout(r, 0));
    expect(t.orchestrator.executeCashuSendQuote).toHaveBeenCalledTimes(1);
  });

  test('reconcile re-sweeps only while leader', async () => {
    const t = makeProcessor({ cashuSendQuotes: [{ id: 'csq' }] });
    await t.processor.start();

    // follower: reconcile is a no-op (sweep-wise)
    await t.processor.onLeadChange('follower');
    await t.processor.reconcile();
    expect(t.orchestrator.executeCashuSendQuote).toHaveBeenCalledTimes(0);

    // leader: reconcile re-runs the resume sweep
    await t.processor.onLeadChange('leader');
    t.orchestrator.executeCashuSendQuote.mockClear();
    await t.processor.reconcile();
    expect(t.orchestrator.executeCashuSendQuote).toHaveBeenCalledTimes(1);
  });
});

describe('BackgroundProcessor reactive cache-invalidation backstop', () => {
  test('an account change invalidates ["accounts"], ["accounts:default"], ["account", id]', () => {
    const t = makeProcessor();
    t.processor.dispatch('ACCOUNT_UPDATED', { id: 'acc1' });

    expect(t.qc.invalidatedKey(['accounts'])).toBe(true);
    expect(t.qc.invalidatedKey(['accounts:default'])).toBe(true);
    expect(t.qc.invalidatedKey(['account', 'acc1'])).toBe(true);
  });

  test('a transaction change invalidates ["transactions"], ["transactions:pendingAck"], ["transaction", id]', () => {
    const t = makeProcessor();
    t.processor.dispatch('TRANSACTION_CREATED', { id: 'tx1' });

    expect(t.qc.invalidatedKey(['transactions'])).toBe(true);
    expect(t.qc.invalidatedKey(['transactions:pendingAck'])).toBe(true);
    expect(t.qc.invalidatedKey(['transaction', 'tx1'])).toBe(true);
  });

  test('a contact change invalidates ["contacts"] + ["contact", id]', () => {
    const t = makeProcessor();
    t.processor.dispatch('CONTACT_DELETED', { id: 'c1' });

    expect(t.qc.invalidatedKey(['contacts'])).toBe(true);
    expect(t.qc.invalidatedKey(['contact', 'c1'])).toBe(true);
  });

  test('a cashu send change invalidates ["cashuSend", id]; receive → ["cashuReceive", id]', () => {
    const send = makeProcessor();
    send.processor.dispatch('CASHU_SEND_QUOTE_UPDATED', { id: 'cs1' });
    expect(send.qc.invalidatedKey(['cashuSend', 'cs1'])).toBe(true);

    const swap = makeProcessor();
    swap.processor.dispatch('CASHU_SEND_SWAP_UPDATED', { id: 'cs2' });
    expect(swap.qc.invalidatedKey(['cashuSend', 'cs2'])).toBe(true);

    const recv = makeProcessor();
    recv.processor.dispatch('CASHU_RECEIVE_QUOTE_UPDATED', { id: 'cr1' });
    expect(recv.qc.invalidatedKey(['cashuReceive', 'cr1'])).toBe(true);
  });

  test('a spark send change invalidates ["sparkSend", id]; receive → ["sparkReceive", id]', () => {
    const send = makeProcessor();
    send.processor.dispatch('SPARK_SEND_QUOTE_UPDATED', { id: 'ss1' });
    expect(send.qc.invalidatedKey(['sparkSend', 'ss1'])).toBe(true);

    const recv = makeProcessor();
    recv.processor.dispatch('SPARK_RECEIVE_QUOTE_UPDATED', { id: 'sr1' });
    expect(recv.qc.invalidatedKey(['sparkReceive', 'sr1'])).toBe(true);
  });

  test('a user change invalidates ["currentUser"]', () => {
    const t = makeProcessor();
    t.processor.dispatch('USER_UPDATED', { id: 'u1' });
    expect(t.qc.invalidatedKey(['currentUser'])).toBe(true);
  });

  test('invalidation runs regardless of leadership (a follower still goes live)', async () => {
    const t = makeProcessor();
    await t.processor.start();
    await t.processor.onLeadChange('follower');
    t.qc.invalidated.length = 0;

    // A quote/swap change a follower does NOT drive (no orchestrator call) STILL invalidates.
    t.processor.dispatch('CASHU_SEND_QUOTE_UPDATED', { id: 'cs1' });

    expect(t.qc.invalidatedKey(['cashuSend', 'cs1'])).toBe(true);
    expect(t.orchestrator.executeCashuSendQuote).toHaveBeenCalledTimes(0);
  });

  test('reconcile invalidates the read-model keys (the reactive invalidate-all)', async () => {
    const t = makeProcessor();
    await t.processor.start();
    await t.processor.onLeadChange('follower');
    t.qc.invalidated.length = 0;

    await t.processor.reconcile();

    // every collection key is refetched so subscribers catch up on missed changes.
    expect(t.qc.invalidatedKey(['accounts'])).toBe(true);
    expect(t.qc.invalidatedKey(['transactions'])).toBe(true);
    expect(t.qc.invalidatedKey(['contacts'])).toBe(true);
    expect(t.qc.invalidatedKey(['cashuSend'])).toBe(true);
    expect(t.qc.invalidatedKey(['sparkReceive'])).toBe(true);
    expect(t.qc.invalidatedKey(['currentUser'])).toBe(true);
  });
});
