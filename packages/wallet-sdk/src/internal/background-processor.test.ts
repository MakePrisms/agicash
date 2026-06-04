/**
 * Background processor tests — Slice 5 / PR7 (the autonomous-runtime capstone).
 *
 * Fakes every collaborator (leader election, realtime hub, orchestrator, the three always-on event
 * forwarders, the two spark substrates, and the six quote/swap repos) and asserts the engine's
 * behaviour:
 *  - lifecycle state machine: stopped → starting → follower/leader → stopping → stopped, each
 *    emitting `background:state`;
 *  - `start()` subscribes the realtime channel + starts lead-polling;
 *  - becoming LEADER runs the resume sweep: it reads each repo's unresolved/pending rows FROM THE
 *    DB and drives each via the orchestrator's kickoff (and is INERT as a follower);
 *  - `dispatch` routes account/transaction/contact realtime changes to their forwarders ALWAYS, and
 *    quote/swap changes to the orchestrator ONLY while leader;
 *  - `reconcile` (the no-cache onConnected) re-sweeps only while leader;
 *  - `stop()` tears down lead-polling + realtime + the spark substrates.
 */
import { describe, expect, mock, test } from 'bun:test';
import {
  BackgroundProcessor,
  type BackgroundProcessorDeps,
} from './background-processor';
import { TypedEventEmitter } from './event-emitter';
import type { SdkEventMap, BackgroundState } from '../events';
import type { SparkAccount } from '../types/account';

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

    // follower: reconcile is a no-op
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
