/**
 * `BackgroundDomainImpl` tests — Slice 5 / PR7 (reactive overlay, design B).
 *
 * Asserts the reactive surface + delegation:
 *  - `state()` returns a MEMOISED `Query<BackgroundState>` (stable ref) whose body reads the
 *    processor's in-memory state;
 *  - `start()` / `stop()` delegate to the processor;
 *  - THE REACTIVE NET-NEW — a `state()` subscriber goes LIVE: driving the engine through a real
 *    `QueryClient` (the processor's `setQueryData` on each transition) pushes the new state to the
 *    subscriber end-to-end (`stopped → starting → leader`).
 *  - AND (the cross-domain backstop) a real `accounts.list()`-style `Query` REFETCHES after the
 *    processor's `dispatch('ACCOUNT_UPDATED')` invalidates `['accounts']`.
 */
import { describe, expect, mock, test } from 'bun:test';
import {
  BackgroundProcessor,
  type BackgroundProcessorDeps,
} from '../internal/background-processor';
import { TypedEventEmitter } from '../internal/event-emitter';
import { QueryClient, toQuery } from '../query';
import type { SdkEventMap } from '../types/events';
import type { Query } from '../types/query';
import { BackgroundDomainImpl } from './background';

/** A real QueryClient + a real BackgroundProcessor over inert fakes (only the wiring under test). */
function makeEngine(client: QueryClient) {
  const events = new TypedEventEmitter<SdkEventMap>();
  const noop = () => undefined;
  const asyncNoop = async () => undefined;
  const deps = {
    events,
    client,
    getUserId: async () => null, // signed out → start() does not subscribe realtime; fine here.
    leaderElection: { start: mock(noop), stop: mock(noop) },
    realtimeHub: { subscribe: mock(noop), stop: mock(asyncNoop) },
    orchestrator: {},
    accountEventForwarder: { handleChange: mock(asyncNoop) },
    transactionEventForwarder: { handleChange: mock(asyncNoop) },
    contactEventForwarder: { handleChange: mock(noop) },
    sparkBalanceTracker: { track: mock(noop), stop: mock(noop) },
    sparkEventForwarder: { track: mock(noop), stop: mock(noop) },
    accounts: { getAllActive: mock(async () => []) },
    cashuSendQuoteRepository: { getUnresolved: mock(async () => []) },
    cashuSendSwapRepository: { getUnresolved: mock(async () => []) },
    cashuReceiveQuoteRepository: { getPending: mock(async () => []) },
    cashuReceiveSwapRepository: { getPending: mock(async () => []) },
    sparkSendQuoteRepository: { getUnresolved: mock(async () => []) },
    sparkReceiveQuoteRepository: { getPending: mock(async () => []) },
  } as unknown as BackgroundProcessorDeps;
  return new BackgroundProcessor(deps);
}

/** Collect the values a `Query` subscriber receives until `stop()` is called. */
function collect<T>(q: Query<T>): { values: T[]; stop: () => void } {
  const values: T[] = [];
  const off = q.subscribe((d) => values.push(d));
  return { values, stop: off };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('BackgroundDomainImpl reactive surface', () => {
  test('state() returns a Query (subscribe/toPromise/getSnapshot) and is memoised', () => {
    const client = new QueryClient();
    const processor = makeEngine(client);
    const domain = new BackgroundDomainImpl(client, processor);

    const q = domain.state();
    expect(typeof q.subscribe).toBe('function');
    expect(typeof q.toPromise).toBe('function');
    expect(typeof q.getSnapshot).toBe('function');
    // Memoised — repeated calls return the SAME stable ref.
    expect(domain.state()).toBe(q);
  });

  test('state().toPromise() resolves to the processor state (stopped before start)', async () => {
    const client = new QueryClient();
    const processor = makeEngine(client);
    const domain = new BackgroundDomainImpl(client, processor);

    expect(await domain.state().toPromise()).toBe('stopped');
  });

  test('start()/stop() delegate to the processor', async () => {
    const client = new QueryClient();
    const processor = makeEngine(client);
    const startSpy = mock(async () => undefined);
    const stopSpy = mock(async () => undefined);
    processor.start = startSpy;
    processor.stop = stopSpy;
    const domain = new BackgroundDomainImpl(client, processor);

    await domain.start();
    await domain.stop();

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  test('a state() subscriber goes LIVE as the engine transitions (the reactive net-new)', async () => {
    const client = new QueryClient();
    const processor = makeEngine(client);
    const domain = new BackgroundDomainImpl(client, processor);

    const sub = collect(domain.state());
    await flush(); // initial fetch → 'stopped'

    await processor.start(); // → 'starting' (setQueryData pushes it)
    await flush();
    await processor.onLeadChange('leader'); // → 'leader'
    await flush();

    // The subscriber observed the live transitions (the processor wrote them into the Query).
    expect(sub.values).toContain('starting');
    expect(sub.values).toContain('leader');
    expect(domain.state().getSnapshot().data).toBe('leader');
    sub.stop();
  });
});

describe('BackgroundProcessor invalidation drives a real domain Query to refetch', () => {
  test('a ["accounts"] Query refetches after dispatch("ACCOUNT_UPDATED")', async () => {
    const client = new QueryClient();
    const processor = makeEngine(client);

    // A real accounts-list-style Query over the SAME client (queryFn is a spy).
    const queryFn = mock(async () => ['acc1']);
    const accountsQuery: Query<string[]> = toQuery(
      client,
      ['accounts'],
      queryFn,
    );
    const sub = collect(accountsQuery);
    await flush();
    expect(queryFn).toHaveBeenCalledTimes(1);

    // A realtime account change invalidates ['accounts'] → the live observer refetches.
    processor.dispatch('ACCOUNT_UPDATED', { id: 'acc1' });
    await flush();

    expect(queryFn.mock.calls.length).toBeGreaterThanOrEqual(2);
    sub.stop();
  });
});
