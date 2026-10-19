import { describe, expect, it } from 'bun:test';
import { nullLogger } from '../../lib/logger';
import type { Account } from '../accounts/account';
import { WalletEventEmitter } from '../sdk/events';
import {
  type WorkingSet,
  createKeyedSerialQueue,
  runAction,
  runWithRetry,
  startWorkingSet,
} from './task-saga';
import {
  type RecordedTimer,
  createRecordingClock,
  createTestStint,
  deferred,
  flush,
} from './task-saga-test-kit';

type Row = {
  id: string;
  version: number;
  pending: boolean;
};

function row(id: string, version: number, pending = true): Row {
  return { id, version, pending };
}

function armed(timers: RecordedTimer[], ms: number): RecordedTimer | undefined {
  const matches = timers.filter((timer) => timer.ms === ms && !timer.cancelled);
  return matches[matches.length - 1];
}

function cashu(id: string, version: number): Account {
  return {
    id,
    type: 'cashu',
    version,
    isOnline: true,
    currency: 'BTC',
    mintUrl: 'https://mint.example',
  } as Account;
}

function spark(id: string, version: number): Account {
  return {
    id,
    type: 'spark',
    version,
    isOnline: true,
    currency: 'BTC',
  } as Account;
}

describe('task saga runtime', () => {
  it('(a) runs jobs for one key FIFO and lets another key run alongside', async () => {
    const queue = createKeyedSerialQueue();
    const { stint } = createTestStint({ queue });
    const events: string[] = [];
    const a1 = deferred<void>();
    const a2 = deferred<void>();
    const a3 = deferred<void>();
    const b1 = deferred<void>();
    queue.enqueue('k', stint.scope, async () => {
      events.push('A1');
      await a1.promise;
    });
    queue.enqueue('k', stint.scope, async () => {
      events.push('A2');
      await a2.promise;
    });
    queue.enqueue('k', stint.scope, async () => {
      events.push('A3');
      await a3.promise;
    });
    queue.enqueue('l', stint.scope, async () => {
      events.push('B1');
      await b1.promise;
    });
    expect(events).toEqual(['A1', 'B1']);
    a1.resolve();
    await flush();
    expect(events).toEqual(['A1', 'B1', 'A2']);
    a2.reject(new Error('A2 failed'));
    await flush();
    expect(events).toEqual(['A1', 'B1', 'A2', 'A3']);
  });

  it('(b) runs the same job function once per enqueue, in order', async () => {
    const queue = createKeyedSerialQueue();
    const { stint } = createTestStint({ queue });
    const calls: number[] = [];
    const job = async (): Promise<void> => {
      calls.push(calls.length + 1);
    };
    queue.enqueue('k', stint.scope, job);
    queue.enqueue('k', stint.scope, job);
    expect(calls).toEqual([1]);
    await flush();
    expect(calls).toEqual([1, 2]);
  });

  it('(c) skips a queued job whose scope died and still runs the next stint', async () => {
    const queue = createKeyedSerialQueue();
    const clock = createRecordingClock();
    const first = createTestStint({ queue, clock });
    const second = createTestStint({ queue, clock });
    const gate = deferred<void>();
    let j1 = 0;
    let j2 = 0;
    let j3 = 0;
    queue.enqueue('k', first.stint.scope, async () => {
      j1 += 1;
      await gate.promise;
    });
    queue.enqueue('k', first.stint.scope, async () => {
      j2 += 1;
    });
    expect(j1).toBe(1);
    expect(j2).toBe(0);
    first.cancel();
    queue.enqueue('k', second.stint.scope, async () => {
      j3 += 1;
    });
    expect(j2).toBe(0);
    expect(j3).toBe(0);
    gate.resolve();
    await flush();
    expect(j1).toBe(1);
    expect(j2).toBe(0);
    expect(j3).toBe(1);
  });

  it('(d) runs an unkeyed job at once while a keyed job is pending', () => {
    const queue = createKeyedSerialQueue();
    const { stint } = createTestStint({ queue });
    const gate = deferred<void>();
    let keyed = false;
    let unkeyed = false;
    queue.enqueue('k', stint.scope, async () => {
      keyed = true;
      await gate.promise;
    });
    queue.enqueue(undefined, stint.scope, async () => {
      unkeyed = true;
    });
    expect(keyed).toBe(true);
    expect(unkeyed).toBe(true);
  });

  it('(e) retries three times with 1s, 2s and 4s delays, then fails', async () => {
    const kit = createTestStint();
    const error = new Error('nope');
    let attempts = 0;
    const outcome = runWithRetry(
      kit.stint,
      async () => {
        attempts += 1;
        throw error;
      },
      3,
    );
    await flush();
    expect(attempts).toBe(1);
    const first = armed(kit.clock.timeouts, 1000);
    expect(first?.ms).toBe(1000);
    first?.callback();
    await flush();
    expect(attempts).toBe(2);
    const second = armed(kit.clock.timeouts, 2000);
    expect(second?.ms).toBe(2000);
    second?.callback();
    await flush();
    expect(attempts).toBe(3);
    const third = armed(kit.clock.timeouts, 4000);
    expect(third?.ms).toBe(4000);
    third?.callback();
    await flush();
    expect(attempts).toBe(4);
    const failed = await outcome;
    expect(failed.status).toBe('failed');
    if (failed.status === 'failed') {
      expect(failed.error).toBe(error);
    }
    expect(armed(kit.clock.timeouts, 8000)).toBeUndefined();
  });

  it('(f) passes the pre-increment failure count to a predicate and stops on fatal', async () => {
    const plainKit = createTestStint();
    const plain = new Error('plain');
    const plainSeen: Array<{ count: number; error: unknown }> = [];
    let plainAttempts = 0;
    const plainOutcome = runWithRetry(
      plainKit.stint,
      async () => {
        plainAttempts += 1;
        throw plain;
      },
      (failureCount, error) => {
        plainSeen.push({ count: failureCount, error });
        return failureCount < 1;
      },
    );
    await flush();
    expect(plainSeen).toEqual([{ count: 0, error: plain }]);
    expect(plainSeen[0]?.error).toBe(plain);
    armed(plainKit.clock.timeouts, 1000)?.callback();
    await flush();
    expect(plainAttempts).toBe(2);
    expect(plainSeen).toEqual([
      { count: 0, error: plain },
      { count: 1, error: plain },
    ]);
    expect(plainSeen[1]?.error).toBe(plain);
    const plainFailed = await plainOutcome;
    expect(plainFailed.status).toBe('failed');

    const fatalKit = createTestStint();
    const fatal = Object.assign(new Error('fatal'), { tag: 'fatal' });
    const fatalSeen: Array<{ count: number; error: unknown }> = [];
    let fatalAttempts = 0;
    const fatalOutcome = runWithRetry(
      fatalKit.stint,
      async () => {
        fatalAttempts += 1;
        throw fatal;
      },
      (failureCount, error) => {
        fatalSeen.push({ count: failureCount, error });
        if (
          typeof error === 'object' &&
          error !== null &&
          'tag' in error &&
          error.tag === 'fatal'
        ) {
          return false;
        }
        return failureCount < 1;
      },
    );
    await flush();
    expect(fatalAttempts).toBe(1);
    expect(fatalSeen).toEqual([{ count: 0, error: fatal }]);
    expect(fatalSeen[0]?.error).toBe(fatal);
    expect(fatalKit.clock.timeouts).toHaveLength(0);
    const fatalFailed = await fatalOutcome;
    expect(fatalFailed.status).toBe('failed');
    if (fatalFailed.status === 'failed') {
      expect(fatalFailed.error).toBe(fatal);
    }
  });

  it('(g) caps the retry delay at 30s', async () => {
    const kit = createTestStint();
    const error = new Error('capped');
    let attempts = 0;
    const outcome = runWithRetry(
      kit.stint,
      async () => {
        attempts += 1;
        throw error;
      },
      6,
    );
    const expected = [1000, 2000, 4000, 8000, 16000, 30000];
    const delays: number[] = [];
    for (const ms of expected) {
      await flush();
      const timer = armed(kit.clock.timeouts, ms);
      expect(timer?.ms).toBe(ms);
      delays.push(timer?.ms ?? 0);
      timer?.callback();
    }
    await flush();
    expect(delays).toEqual(expected);
    expect(kit.clock.timeouts.map((timer) => timer.ms)).toEqual(expected);
    expect(attempts).toBe(7);
    const failed = await outcome;
    expect(failed.status).toBe('failed');
    if (failed.status === 'failed') {
      expect(failed.error).toBe(error);
    }
  });

  it('(h) abandons a retry that ends while the host is inactive', async () => {
    const kit = createTestStint();
    let attempts = 0;
    const outcome = runWithRetry(
      kit.stint,
      async () => {
        attempts += 1;
        throw new Error('later');
      },
      3,
    );
    await flush();
    expect(attempts).toBe(1);
    kit.activity.setActive(false);
    armed(kit.clock.timeouts, 1000)?.callback();
    await flush();
    expect(attempts).toBe(1);
    expect(await outcome).toEqual({ status: 'abandoned' });
  });

  it('(i) abandons when the scope is cancelled during the backoff', async () => {
    const kit = createTestStint();
    let attempts = 0;
    const outcome = runWithRetry(
      kit.stint,
      async () => {
        attempts += 1;
        throw new Error('cancel me');
      },
      3,
    );
    await flush();
    expect(attempts).toBe(1);
    const timer = armed(kit.clock.timeouts, 1000);
    expect(timer).toBeDefined();
    kit.cancel();
    await flush();
    expect(attempts).toBe(1);
    expect(timer?.cancelled).toBe(true);
    expect(kit.clock.timeouts.filter((item) => !item.cancelled)).toHaveLength(
      0,
    );
    expect(await outcome).toEqual({ status: 'abandoned' });
  });

  it('(j) runs the first attempt even when the host is inactive', async () => {
    const kit = createTestStint();
    kit.activity.setActive(false);
    let attempts = 0;
    const outcome = runWithRetry(
      kit.stint,
      async () => {
        attempts += 1;
        return 'ok';
      },
      3,
    );
    expect(await outcome).toEqual({ status: 'succeeded', value: 'ok' });
    expect(attempts).toBe(1);
    expect(kit.clock.timeouts).toHaveLength(0);
  });

  it('(k) version-gates apply, tombstones removals, and finds by predicate', () => {
    const { stint } = createTestStint();
    const changes: number[] = [];
    const set = startWorkingSet<Row>(stint, {
      name: 'test',
      keyOf: (item) => item.id,
      isPending: (item) => item.pending,
      load: () => new Promise(() => undefined),
      onChange: () => {
        changes.push(1);
      },
    });
    const v2 = row('a', 2);
    set.apply(v2);
    set.apply(row('a', 1));
    expect(set.get('a')).toBe(v2);
    set.apply(row('a', 3, false));
    expect(set.get('a')).toBeUndefined();
    set.apply(row('a', 2));
    expect(set.get('a')).toBeUndefined();
    const v4 = row('a', 4);
    set.apply(v4);
    expect(set.get('a')).toBe(v4);
    const created = row('b', 1);
    set.apply(created);
    expect(set.get('b')).toBe(created);
    expect(set.find((item) => item.id === 'b')).toBe(created);
    expect(set.find((item) => item.id === 'missing')).toBeUndefined();
    expect(set.values()).toEqual([v4, created]);
    expect(changes.length).toBeGreaterThan(0);
  });

  it('(l) keeps a newer or in-flight apply when a load lands, then drops it on the next load', async () => {
    const kit = createTestStint();
    const resolvers: Array<(rows: Row[]) => void> = [];
    const set = startWorkingSet<Row>(kit.stint, {
      name: 'test',
      keyOf: (item) => item.id,
      isPending: (item) => item.pending,
      load: () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
      onChange: () => undefined,
    });
    expect(resolvers).toHaveLength(1);
    set.apply(row('x', 5));
    set.apply(row('y', 1));
    resolvers[0]?.([row('x', 4), row('z', 1)]);
    await flush();
    expect(set.values().map((item) => [item.id, item.version])).toEqual([
      ['x', 5],
      ['z', 1],
      ['y', 1],
    ]);
    kit.events.emit('connection.changed', { state: 'connected' });
    expect(resolvers).toHaveLength(2);
    resolvers[1]?.([row('z', 1)]);
    await flush();
    expect(set.get('x')).toBeUndefined();
    expect(set.get('y')).toBeUndefined();
    expect(set.get('z')?.version).toBe(1);
    expect(set.values()).toHaveLength(1);
  });

  it('(l3) lets a loaded row with a higher version win over an in-flight apply', async () => {
    const kit = createTestStint();
    const resolvers: Array<(rows: Row[]) => void> = [];
    const set = startWorkingSet<Row>(kit.stint, {
      name: 'test',
      keyOf: (item) => item.id,
      isPending: (item) => item.pending,
      load: () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
      onChange: () => undefined,
    });
    set.apply(row('a', 2));
    const loaded = row('a', 5);
    resolvers[0]?.([loaded]);
    await flush();
    expect(set.get('a')).toBe(loaded);
  });

  it('(l4) keeps an in-flight item the load omitted, runs one more load, and drops it if omitted again', async () => {
    const kit = createTestStint();
    const resolvers: Array<(rows: Row[]) => void> = [];
    const set = startWorkingSet<Row>(kit.stint, {
      name: 'test',
      keyOf: (item) => item.id,
      isPending: (item) => item.pending,
      load: () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
      onChange: () => undefined,
    });
    const applied = row('y', 1);
    set.apply(applied);
    resolvers[0]?.([]);
    await flush();
    expect(set.get('y')).toBe(applied);
    expect(resolvers).toHaveLength(2);
    resolvers[1]?.([]);
    await flush();
    expect(set.get('y')).toBeUndefined();
    expect(resolvers).toHaveLength(2);
  });

  it('(l2) keeps a tombstone across reloads so a late echo cannot re-add a finished item', async () => {
    const kit = createTestStint();
    const resolvers: Array<(rows: Row[]) => void> = [];
    const set = startWorkingSet<Row>(kit.stint, {
      name: 'test',
      keyOf: (item) => item.id,
      isPending: (item) => item.pending,
      load: () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
      onChange: () => undefined,
    });
    resolvers[0]?.([row('x', 2)]);
    await flush();
    set.apply(row('x', 3, false));
    expect(set.get('x')).toBeUndefined();
    kit.events.emit('connection.changed', { state: 'connected' });
    resolvers[1]?.([]);
    await flush();
    set.apply(row('x', 2));
    expect(set.get('x')).toBeUndefined();
    const reopened = row('x', 4);
    set.apply(reopened);
    expect(set.get('x')).toBe(reopened);
  });

  it('(m) reloads on a later connect and on activation, not on the subscribe replay', async () => {
    const events = new WalletEventEmitter(nullLogger);
    events.emit('connection.changed', { state: 'connected' });
    const kit = createTestStint({ events });
    let loads = 0;
    startWorkingSet<Row>(kit.stint, {
      name: 'test',
      keyOf: (item) => item.id,
      isPending: (item) => item.pending,
      load: async () => {
        loads += 1;
        return [];
      },
      onChange: () => undefined,
    });
    expect(loads).toBe(1);
    await flush();
    expect(loads).toBe(1);
    kit.events.emit('connection.changed', { state: 'connected' });
    expect(loads).toBe(2);
    await flush();
    expect(loads).toBe(2);
    kit.activity.setActive(false);
    kit.activity.notify();
    await flush();
    expect(loads).toBe(2);
    kit.activity.setActive(true);
    kit.activity.notify();
    expect(loads).toBe(3);
    await flush();
    expect(loads).toBe(3);
    kit.activity.setActive(true);
    kit.activity.notify();
    await flush();
    expect(loads).toBe(3);
  });

  it('(n) coalesces triggers that arrive during a load into one more load', async () => {
    const kit = createTestStint();
    const resolvers: Array<(rows: Row[]) => void> = [];
    startWorkingSet<Row>(kit.stint, {
      name: 'test',
      keyOf: (item) => item.id,
      isPending: (item) => item.pending,
      load: () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
      onChange: () => undefined,
    });
    expect(resolvers).toHaveLength(1);
    kit.events.emit('connection.changed', { state: 'connected' });
    kit.events.emit('connection.changed', { state: 'connected' });
    kit.events.emit('connection.changed', { state: 'connected' });
    expect(resolvers).toHaveLength(1);
    resolvers[0]?.([]);
    await flush();
    expect(resolvers).toHaveLength(2);
    resolvers[1]?.([]);
    await flush();
    expect(resolvers).toHaveLength(2);
  });

  it('(o) warns after four failed loads and leaves the held items in place', async () => {
    const kit = createTestStint();
    const error = new Error('load failed');
    let fail = false;
    let loads = 0;
    let changes = 0;
    const set: WorkingSet<Row> = startWorkingSet<Row>(kit.stint, {
      name: 'test',
      keyOf: (item) => item.id,
      isPending: (item) => item.pending,
      load: () => {
        loads += 1;
        if (fail) {
          return Promise.reject(error);
        }
        return Promise.resolve([row('kept', 1)]);
      },
      onChange: () => {
        changes += 1;
      },
    });
    await flush();
    expect(loads).toBe(1);
    expect(changes).toBe(1);
    expect(set.get('kept')?.version).toBe(1);
    fail = true;
    kit.events.emit('connection.changed', { state: 'connected' });
    expect(loads).toBe(2);
    await flush();
    armed(kit.clock.timeouts, 1000)?.callback();
    await flush();
    expect(loads).toBe(3);
    armed(kit.clock.timeouts, 2000)?.callback();
    await flush();
    expect(loads).toBe(4);
    armed(kit.clock.timeouts, 4000)?.callback();
    await flush();
    expect(loads).toBe(5);
    expect(kit.logger.warnLog).toEqual([
      {
        message: 'Failed to load pending tasks',
        meta: { saga: 'test', cause: error },
      },
    ]);
    expect(
      (kit.logger.warnLog[0]?.meta as { cause: unknown } | undefined)?.cause,
    ).toBe(error);
    expect(set.get('kept')).toEqual(row('kept', 1));
    expect(changes).toBe(1);
    expect(armed(kit.clock.timeouts, 8000)).toBeUndefined();
  });

  it('(p) loads accounts once per fresh read, version-gates apply, and reloads after stale', async () => {
    const resolvers: Array<(accounts: Account[]) => void> = [];
    const kit = createTestStint({
      loadAccounts: () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    });
    expect(kit.loadAccountCalls).toHaveLength(0);
    const first = kit.stint.accounts.get('account-1');
    const second = kit.stint.accounts.get('account-1');
    expect(kit.loadAccountCalls).toHaveLength(1);
    expect(kit.loadAccountCalls[0]?.userId).toBe('user-1');
    expect(kit.loadAccountCalls[0]?.signal).toBeInstanceOf(AbortSignal);
    const v1 = cashu('account-1', 1);
    const sparkAccount = spark('spark-1', 1);
    resolvers[0]?.([v1, sparkAccount]);
    expect(await first).toBe(v1);
    expect(await second).toBe(v1);
    const v2 = cashu('account-1', 2);
    kit.stint.accounts.apply(v2);
    expect(await kit.stint.accounts.get('account-1')).toBe(v2);
    kit.stint.accounts.apply(v1);
    expect(await kit.stint.accounts.get('account-1')).toBe(v2);
    kit.stint.accounts.markStale();
    const afterStale = kit.stint.accounts.get('account-1');
    expect(kit.loadAccountCalls).toHaveLength(2);
    resolvers[1]?.([v1, sparkAccount]);
    expect(await afterStale).toBe(v1);
    const callsBeforeConnect = kit.loadAccountCalls.length;
    kit.events.emit('connection.changed', { state: 'connected' });
    expect(kit.loadAccountCalls).toHaveLength(callsBeforeConnect);
    const afterConnect = kit.stint.accounts.get('account-1');
    expect(kit.loadAccountCalls).toHaveLength(callsBeforeConnect + 1);
    resolvers[2]?.([v2, sparkAccount]);
    expect((await afterConnect)?.version).toBe(2);
    await expect(kit.stint.accounts.getCashu('spark-1')).rejects.toThrow(
      'Account with id: spark-1 is not of type: cashu',
    );
  });

  it('(r) does not emit after the stint scope is cancelled', () => {
    const kit = createTestStint();
    const seen: string[] = [];
    kit.events.on('cashu-receive-swap.updated', () => {
      seen.push('updated');
    });
    kit.stint.emit({
      event: 'cashu-receive-swap.updated',
      payload: {
        swap: { tokenHash: 'hash-1' } as never,
      },
    });
    expect(seen).toEqual(['updated']);
    kit.cancel();
    kit.stint.emit({
      event: 'cashu-receive-swap.updated',
      payload: {
        swap: { tokenHash: 'hash-2' } as never,
      },
    });
    expect(seen).toEqual(['updated']);
  });

  it('(x) calls onGiveUp after onError when failed, once when abandoned, and not after the scope dies', async () => {
    const failedKit = createTestStint();
    const failedOrder: string[] = [];
    const failedError = new Error('give up');
    runAction(failedKit.stint, {
      key: 'failed',
      retry: 0,
      attempt: async () => {
        throw failedError;
      },
      onError: (error) => {
        failedOrder.push('onError');
        expect(error).toBe(failedError);
      },
      onGiveUp: () => {
        failedOrder.push('onGiveUp');
      },
    });
    await flush();
    expect(failedOrder).toEqual(['onError', 'onGiveUp']);

    const abandonedKit = createTestStint();
    const abandonedOrder: string[] = [];
    runAction(abandonedKit.stint, {
      key: 'abandoned',
      retry: 3,
      attempt: async () => {
        throw new Error('backoff');
      },
      onError: () => {
        abandonedOrder.push('onError');
      },
      onGiveUp: () => {
        abandonedOrder.push('onGiveUp');
      },
    });
    await flush();
    abandonedKit.activity.setActive(false);
    armed(abandonedKit.clock.timeouts, 1000)?.callback();
    await flush();
    expect(abandonedOrder).toEqual(['onGiveUp']);

    const deadKit = createTestStint();
    const deadOrder: string[] = [];
    runAction(deadKit.stint, {
      key: 'dead',
      retry: 3,
      attempt: async () => {
        throw new Error('cancelled');
      },
      onError: () => {
        deadOrder.push('onError');
      },
      onGiveUp: () => {
        deadOrder.push('onGiveUp');
      },
    });
    await flush();
    expect(armed(deadKit.clock.timeouts, 1000)).toBeDefined();
    deadKit.cancel();
    await flush();
    expect(deadOrder).toEqual([]);
  });
});
