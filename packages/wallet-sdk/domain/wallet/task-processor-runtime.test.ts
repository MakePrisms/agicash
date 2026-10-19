import { describe, expect, it } from 'bun:test';
import type { AgicashDb } from '../../db/database';
import {
  DisposedError,
  NoSessionError,
  NotImplementedError,
} from '../../lib/error';
import { nullLogger } from '../../lib/logger';
import type { ScopeClock } from '../../lib/run-scope';
import type {
  ActivityMonitor,
  AuthKeyValueStore,
  AuthSession,
  Logger,
  SdkConfig,
  TaskProcessorState,
} from '../sdk';
import { WalletEventEmitter } from '../sdk/events';
import { AgicashSdk } from '../sdk/sdk';
import {
  type TaskProcessorDeps,
  createTaskProcessor,
} from './task-processor-runtime';
import type { SagaStint, TaskSaga } from './task-saga';
import { deferred } from './task-saga-test-kit';

const CLIENT_A = '00000000-0000-4000-8000-000000000001';
const CLIENT_B = '00000000-0000-4000-8000-000000000002';

const loggedIn = {
  isLoggedIn: true,
  user: { id: 'user-1' },
} as AuthSession;

const loggedOut: AuthSession = { isLoggedIn: false };

const alwaysActive: ActivityMonitor = {
  isActive: () => true,
  subscribe: () => () => undefined,
};

type RecordedTimer = {
  ms: number;
  callback: () => void;
  cancel: () => void;
  cancelled: boolean;
};

type LeadCall = {
  userId: string;
  clientId: string;
  signal: AbortSignal | undefined;
  resolve: (value: boolean) => void;
  reject: (error: unknown) => void;
};

type Emit = { state: TaskProcessorState; error?: unknown };

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createRecordingClock(): ScopeClock & {
  intervals: RecordedTimer[];
  timeouts: RecordedTimer[];
} {
  const intervals: RecordedTimer[] = [];
  const timeouts: RecordedTimer[] = [];
  const arm = (bucket: RecordedTimer[]) => {
    return (callback: () => void, ms: number) => {
      const timer: RecordedTimer = {
        ms,
        callback,
        cancelled: false,
        cancel: () => undefined,
      };
      const cancel = () => {
        timer.cancelled = true;
      };
      timer.cancel = cancel;
      bucket.push(timer);
      return cancel;
    };
  };
  return {
    intervals,
    timeouts,
    setInterval: arm(intervals),
    setTimeout: arm(timeouts),
  };
}

function createActivity(initial: { active: boolean }): {
  activity: ActivityMonitor;
  setActive: (value: boolean) => void;
  notify: () => void;
} {
  let active = initial.active;
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
    setActive: (value) => {
      active = value;
    },
    notify: () => {
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

function createHarness(options?: {
  session?: AuthSession;
  takeLead?: TaskProcessorDeps['takeLead'];
  activity?: ActivityMonitor;
  db?: AgicashDb;
  clock?: boolean;
  randomUUID?: boolean;
  sagas?: TaskSaga[];
}): {
  processor: ReturnType<typeof createTaskProcessor>;
  calls: LeadCall[];
  emits: Emit[];
  debugLog: Array<{ message: string; meta: unknown }>;
  warnLog: Array<{ message: string; meta: unknown }>;
  errorLog: Array<{ message: string; meta: unknown }>;
  clock: ReturnType<typeof createRecordingClock> | undefined;
  uuidCount: () => number;
  setSession: (session: AuthSession) => void;
} {
  const calls: LeadCall[] = [];
  const emits: Emit[] = [];
  const debugLog: Array<{ message: string; meta: unknown }> = [];
  const warnLog: Array<{ message: string; meta: unknown }> = [];
  const errorLog: Array<{ message: string; meta: unknown }> = [];
  const walletEvents = new WalletEventEmitter(nullLogger);
  let session = options?.session ?? loggedIn;
  let uuidCount = 0;
  const uuids = [CLIENT_A, CLIENT_B];
  const clock = options?.clock === false ? undefined : createRecordingClock();
  const takeLead =
    options?.takeLead ??
    ((
      userId: string,
      clientId: string,
      leadOptions?: { abortSignal?: AbortSignal },
    ) =>
      new Promise<boolean>((resolve, reject) => {
        calls.push({
          userId,
          clientId,
          signal: leadOptions?.abortSignal,
          resolve,
          reject,
        });
      }));
  const logger: Logger = {
    debug: (message, meta) => {
      debugLog.push({ message, meta });
    },
    info: () => undefined,
    warn: (message, meta) => {
      warnLog.push({ message, meta });
    },
    error: (message, meta) => {
      errorLog.push({ message, meta });
    },
  };
  const deps: TaskProcessorDeps = {
    db: options?.db ?? ({} as AgicashDb),
    getSession: () => session,
    activity: options?.activity ?? alwaysActive,
    emit: (payload) => {
      emits.push(payload);
    },
    logger,
    takeLead,
    clock,
    walletEvents: {
      on: (event, handler) => walletEvents.on(event, handler),
      emit: (message) =>
        walletEvents.emit(message.event, message.payload as never),
    },
    loadAccounts: async () => [],
    sagas: options?.sagas ?? [],
    randomUUID:
      options?.randomUUID === false
        ? undefined
        : () => {
            const id = uuids[uuidCount] ?? CLIENT_B;
            uuidCount += 1;
            return id;
          },
  };
  return {
    processor: createTaskProcessor(deps),
    calls,
    emits,
    debugLog,
    warnLog,
    errorLog,
    clock,
    uuidCount: () => uuidCount,
    setSession: (next) => {
      session = next;
    },
  };
}

function latestTimeout(timeouts: RecordedTimer[], ms: number): RecordedTimer {
  const matches = timeouts.filter((timer) => timer.ms === ms);
  const timer = matches[matches.length - 1];
  if (!timer) {
    throw new Error(`missing ${ms}ms timeout`);
  }
  return timer;
}

async function becomeLeader(
  harness: ReturnType<typeof createHarness>,
): Promise<void> {
  harness.processor.start();
  expect(harness.calls).toHaveLength(1);
  harness.calls[0]?.resolve(true);
  await flush();
  expect(harness.processor.state).toBe('leader');
}

const createMemoryStore = (): AuthKeyValueStore => {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
};

const createConfig = (): SdkConfig => ({
  db: { url: 'http://localhost:54321', anonKey: 'anon-key' },
  activity: alwaysActive,
  auth: {
    apiUrl: 'http://localhost:3100',
    clientId: '00000000-0000-0000-0000-000000000000',
    storage: { persistent: createMemoryStore(), session: createMemoryStore() },
  },
  spark: { breezApiKey: 'key', network: 'MAINNET' },
  lightningAddressDomain: 'localhost',
  logger: nullLogger,
});

describe('createTaskProcessor', () => {
  it('(a) throws NoSessionError when logged out and does not arm the loop', () => {
    const harness = createHarness({ session: loggedOut });
    expect(() => harness.processor.start()).toThrow(NoSessionError);
    expect(harness.calls).toHaveLength(0);
    expect(harness.processor.state).toBe('stopped');
    expect(harness.emits).toHaveLength(0);
    expect(harness.clock?.intervals).toHaveLength(0);
  });

  it('(b) mounts as follower, becomes leader, and renews without a second emit', async () => {
    const harness = createHarness();
    const started = harness.processor.start();
    expect(started).toBeUndefined();
    expect(harness.emits).toHaveLength(1);
    expect(harness.emits[0]).toEqual({ state: 'follower' });
    expect(Object.keys(harness.emits[0] ?? {})).toEqual(['state']);
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]?.userId).toBe('user-1');
    expect(harness.calls[0]?.clientId).toBe(CLIENT_A);
    expect(harness.calls[0]?.signal).toBeInstanceOf(AbortSignal);
    harness.calls[0]?.resolve(true);
    await flush();
    expect(harness.processor.state).toBe('leader');
    expect(harness.emits).toHaveLength(2);
    expect(harness.emits[1]).toEqual({ state: 'leader' });
    expect(Object.keys(harness.emits[1] ?? {})).toEqual(['state']);
    expect(harness.debugLog).toEqual([
      {
        message: 'Taking lead on task processing',
        meta: { clientId: CLIENT_A },
      },
    ]);
    const interval = harness.clock?.intervals[0];
    expect(interval?.ms).toBe(5000);
    interval?.callback();
    await flush();
    expect(harness.calls).toHaveLength(2);
    expect(harness.calls[1]?.clientId).toBe(CLIENT_A);
    harness.calls[1]?.resolve(true);
    await flush();
    expect(harness.emits).toHaveLength(2);
    expect(harness.debugLog).toHaveLength(1);
  });

  it('(c) yields the lead once and ignores a repeated false', async () => {
    const harness = createHarness();
    await becomeLeader(harness);
    harness.clock?.intervals[0]?.callback();
    await flush();
    expect(harness.calls).toHaveLength(2);
    harness.calls[1]?.resolve(false);
    await flush();
    expect(harness.processor.state).toBe('follower');
    expect(harness.debugLog[1]).toEqual({
      message: 'Yielded lead on task processing',
      meta: { clientId: CLIENT_A },
    });
    const emitCount = harness.emits.length;
    const debugCount = harness.debugLog.length;
    harness.clock?.intervals[0]?.callback();
    await flush();
    harness.calls[2]?.resolve(false);
    await flush();
    expect(harness.debugLog).toHaveLength(debugCount);
    expect(harness.emits).toHaveLength(emitCount);
  });

  it('(d) does not mint a second id or interval while already leader', async () => {
    const harness = createHarness();
    await becomeLeader(harness);
    harness.processor.start();
    expect(harness.uuidCount()).toBe(1);
    expect(harness.clock?.intervals).toHaveLength(1);
  });

  it('(e) keeps an inactive leader and refetches once it is active again', async () => {
    const activity = createActivity({ active: true });
    const harness = createHarness({ activity: activity.activity });
    await becomeLeader(harness);
    activity.setActive(false);
    harness.clock?.intervals[0]?.callback();
    await flush();
    expect(harness.calls).toHaveLength(1);
    expect(harness.processor.state).toBe('leader');
    activity.setActive(true);
    activity.notify();
    await flush();
    expect(harness.calls).toHaveLength(2);
    harness.calls[1]?.resolve(false);
    await flush();
    expect(harness.processor.state).toBe('follower');
  });

  it('(f) does not attempt while inactive and attempts once on activation', async () => {
    const activity = createActivity({ active: false });
    const harness = createHarness({ activity: activity.activity });
    harness.processor.start();
    expect(harness.processor.state).toBe('follower');
    expect(harness.calls).toHaveLength(0);
    harness.clock?.intervals[0]?.callback();
    await flush();
    expect(harness.calls).toHaveLength(0);
    activity.setActive(true);
    activity.notify();
    await flush();
    expect(harness.calls).toHaveLength(1);
    harness.calls[0]?.resolve(true);
    await flush();
    expect(harness.processor.state).toBe('leader');
  });

  it('(g) retries three times, warns, and starts a fresh cycle on the next tick', async () => {
    const harness = createHarness();
    await becomeLeader(harness);
    const error = new Error('db down');
    const timeouts = harness.clock?.timeouts ?? [];
    harness.clock?.intervals[0]?.callback();
    await flush();
    expect(harness.calls).toHaveLength(2);
    harness.calls[1]?.reject(error);
    await flush();
    expect(timeouts.map((timer) => timer.ms)).toContain(1000);
    latestTimeout(timeouts, 1000).callback();
    await flush();
    expect(harness.calls).toHaveLength(3);
    harness.calls[2]?.reject(error);
    await flush();
    expect(timeouts.map((timer) => timer.ms)).toContain(2000);
    latestTimeout(timeouts, 2000).callback();
    await flush();
    expect(harness.calls).toHaveLength(4);
    harness.calls[3]?.reject(error);
    await flush();
    expect(timeouts.map((timer) => timer.ms)).toContain(4000);
    latestTimeout(timeouts, 4000).callback();
    await flush();
    expect(harness.calls).toHaveLength(5);
    harness.calls[4]?.reject(error);
    await flush();
    expect(harness.warnLog).toEqual([
      {
        message: 'Error. Take lead request failed. Will retry in 5 seconds.',
        meta: { cause: error },
      },
    ]);
    expect(
      (harness.warnLog[0]?.meta as { cause: unknown } | undefined)?.cause,
    ).toBe(error);
    expect(harness.processor.state).toBe('leader');
    expect(harness.emits.some((payload) => payload.state === 'error')).toBe(
      false,
    );
    harness.clock?.intervals[0]?.callback();
    await flush();
    expect(harness.calls).toHaveLength(6);
  });

  it('(h) abandons a retry while inactive and bids afresh on activation', async () => {
    const activity = createActivity({ active: true });
    const harness = createHarness({ activity: activity.activity });
    await becomeLeader(harness);
    harness.clock?.intervals[0]?.callback();
    await flush();
    harness.calls[1]?.reject(new Error('db down'));
    await flush();
    const delay = latestTimeout(harness.clock?.timeouts ?? [], 1000);
    delay.callback();
    activity.setActive(false);
    await flush();
    expect(harness.calls).toHaveLength(2);
    harness.clock?.intervals[0]?.callback();
    await flush();
    expect(harness.calls).toHaveLength(2);
    activity.setActive(true);
    activity.notify();
    await flush();
    expect(harness.calls).toHaveLength(3);
  });

  it('(i) resolves stop when the in-flight attempt aborts and a second stop is quiet', async () => {
    const calls: LeadCall[] = [];
    const harness = createHarness({
      takeLead: (userId, clientId, options) =>
        new Promise((resolve, reject) => {
          const signal = options?.abortSignal;
          calls.push({
            userId,
            clientId,
            signal,
            resolve,
            reject,
          });
          signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    });
    harness.processor.start();
    expect(calls).toHaveLength(1);
    const signal = calls[0]?.signal;
    const stopPromise = harness.processor.stop();
    expect(signal?.aborted).toBe(true);
    const stopTimer = latestTimeout(harness.clock?.timeouts ?? [], 5000);
    await flush();
    expect(stopTimer.cancelled).toBe(true);
    await stopPromise;
    expect(harness.processor.state).toBe('stopped');
    const states = harness.emits.map((payload) => payload.state);
    await harness.processor.stop();
    expect(harness.emits.map((payload) => payload.state)).toEqual(states);
    expect(states).toEqual(['follower', 'stopped']);
  });

  it('(j) ignores a late true after the stop checkpoint times out', async () => {
    const harness = createHarness();
    harness.processor.start();
    expect(harness.calls).toHaveLength(1);
    const stopPromise = harness.processor.stop();
    let stopSettled = false;
    void stopPromise.then(() => {
      stopSettled = true;
    });
    await flush();
    expect(stopSettled).toBe(false);
    latestTimeout(harness.clock?.timeouts ?? [], 5000).callback();
    await stopPromise;
    expect(harness.processor.state).toBe('stopped');
    const emitCount = harness.emits.length;
    harness.calls[0]?.resolve(true);
    await flush();
    expect(harness.processor.state).toBe('stopped');
    expect(harness.emits).toHaveLength(emitCount);
    expect(harness.emits.at(-1)?.state).toBe('stopped');
  });

  it('(k) stop then start in the same turn reuses the client id', async () => {
    const harness = createHarness();
    harness.processor.start();
    const stopPromise = harness.processor.stop();
    harness.processor.start();
    expect(harness.calls).toHaveLength(2);
    expect(harness.calls[1]?.clientId).toBe(CLIENT_A);
    expect(harness.uuidCount()).toBe(1);
    harness.calls[0]?.resolve(true);
    await flush();
    expect(harness.processor.state).toBe('follower');
    const liveInterval = (harness.clock?.intervals ?? []).at(-1);
    liveInterval?.callback();
    await flush();
    expect(harness.calls).toHaveLength(2);
    harness.calls[1]?.resolve(true);
    await flush();
    expect(harness.processor.state).toBe('leader');
    const pending = (harness.clock?.timeouts ?? []).find(
      (timer) => timer.ms === 5000 && !timer.cancelled,
    );
    pending?.callback();
    await stopPromise;
  });

  it('(l) a logged-out tick stops without another takeLead', async () => {
    const harness = createHarness();
    await becomeLeader(harness);
    harness.setSession(loggedOut);
    harness.clock?.intervals[0]?.callback();
    await flush();
    expect(harness.calls).toHaveLength(1);
    expect(harness.processor.state).toBe('stopped');
  });

  it('(m) ignores activity and interval kicks while a takeLead is in flight', async () => {
    const activity = createActivity({ active: true });
    const harness = createHarness({ activity: activity.activity });
    harness.processor.start();
    expect(harness.calls).toHaveLength(1);
    activity.notify();
    harness.clock?.intervals[0]?.callback();
    await flush();
    expect(harness.calls).toHaveLength(1);
    harness.calls[0]?.resolve(true);
    await flush();
    expect(harness.processor.state).toBe('leader');
  });

  it('(n) calls wallet.take_lead through the repository when no seam is set', async () => {
    const rpcCalls: Array<{ fn: string; args: unknown }> = [];
    const abortSignals: unknown[] = [];
    const db = {
      rpc(fn: string, args: unknown) {
        rpcCalls.push({ fn, args });
        const result = Promise.resolve({ data: true, error: null });
        return Object.assign(result, {
          abortSignal(signal: unknown) {
            abortSignals.push(signal);
            return this;
          },
        });
      },
    } as unknown as AgicashDb;
    const clock = createRecordingClock();
    let uuidCount = 0;
    const processor = createTaskProcessor({
      db,
      getSession: () => loggedIn,
      activity: alwaysActive,
      emit: () => undefined,
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      randomUUID: () => {
        uuidCount += 1;
        return uuidCount === 1 ? CLIENT_A : CLIENT_B;
      },
      clock,
      walletEvents: {
        on: () => () => undefined,
        emit: () => undefined,
      },
      loadAccounts: async () => [],
      sagas: [],
    });
    processor.start();
    expect(rpcCalls).toEqual([
      {
        fn: 'take_lead',
        args: {
          p_user_id: 'user-1',
          p_client_id: CLIENT_A,
        },
      },
    ]);
    expect(abortSignals).toHaveLength(1);
    expect(abortSignals[0]).toBeInstanceOf(AbortSignal);
    await processor.stop();
  });

  it('(o) polls unconditionally under alwaysActive', async () => {
    const harness = createHarness({ activity: alwaysActive });
    harness.processor.start();
    expect(harness.calls).toHaveLength(1);
    harness.calls[0]?.resolve(true);
    await flush();
    harness.clock?.intervals[0]?.callback();
    await flush();
    expect(harness.calls).toHaveLength(2);
    harness.calls[1]?.resolve(true);
    await flush();
    await harness.processor.stop();
  });

  it('(p) wires taskProcessor on AgicashSdk', async () => {
    const sdk = AgicashSdk.create(createConfig());
    let disposed = false;
    try {
      expect(sdk.taskProcessor).toBe(sdk.taskProcessor);
      expect(sdk.taskProcessor.state).toBe('stopped');
      expect(() => sdk.taskProcessor.start()).toThrow(NoSessionError);
      expect(() => sdk.featureFlags).toThrow(NotImplementedError);
      await sdk.dispose();
      disposed = true;
      expect(() => sdk.taskProcessor.start()).toThrow(DisposedError);
      await sdk.taskProcessor.stop();
      const next = AgicashSdk.create(createConfig());
      try {
        expect(next.taskProcessor.state).toBe('stopped');
      } finally {
        await next.dispose();
      }
    } finally {
      if (!disposed) {
        await sdk.dispose();
      }
    }
  });

  it('(s) starts one stint when this instance takes the lead and a new one after yielding', async () => {
    const started: SagaStint[] = [];
    const record = (name: string): TaskSaga => ({
      name,
      start(stint) {
        started.push(stint);
      },
    });
    const harness = createHarness({
      sagas: [record('one'), record('two')],
    });
    await becomeLeader(harness);
    expect(started).toHaveLength(2);
    expect(started[0]).toBe(started[1]);
    expect(started[0]?.userId).toBe('user-1');
    expect(started[0]?.scope.alive).toBe(true);
    harness.clock?.intervals[0]?.callback();
    await flush();
    expect(harness.calls).toHaveLength(2);
    harness.calls[1]?.resolve(true);
    await flush();
    expect(started).toHaveLength(2);
    harness.clock?.intervals[0]?.callback();
    await flush();
    expect(harness.calls).toHaveLength(3);
    harness.calls[2]?.resolve(false);
    await flush();
    expect(started[0]?.scope.alive).toBe(false);
    expect(started[0]?.scope.signal.aborted).toBe(true);
    harness.clock?.intervals[0]?.callback();
    await flush();
    expect(harness.calls).toHaveLength(4);
    harness.calls[3]?.resolve(true);
    await flush();
    expect(started).toHaveLength(4);
    expect(started[2]).toBe(started[3]);
    expect(started[2]).not.toBe(started[0]);
    expect(started[2]?.scope.alive).toBe(true);
  });

  it('(t) stop joins the saga checkpoint and cancels its single 5000 timer', async () => {
    const gate = deferred<void>();
    const harness = createHarness({
      sagas: [
        {
          name: 'hung',
          start(stint) {
            stint.scope.track(gate.promise);
          },
        },
      ],
    });
    await becomeLeader(harness);
    const stopPromise = harness.processor.stop();
    let settled = false;
    void stopPromise.then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);
    const timers = (harness.clock?.timeouts ?? []).filter(
      (timer) => timer.ms === 5000,
    );
    expect(timers).toHaveLength(1);
    expect(timers[0]?.cancelled).toBe(false);
    gate.resolve();
    await flush();
    await stopPromise;
    expect(settled).toBe(true);
    expect(timers[0]?.cancelled).toBe(true);
  });

  it('(u) stop resolves when its single 5000 timer fires', async () => {
    const harness = createHarness({
      sagas: [
        {
          name: 'hung',
          start(stint) {
            stint.scope.track(new Promise(() => undefined));
          },
        },
      ],
    });
    await becomeLeader(harness);
    const stopPromise = harness.processor.stop();
    let settled = false;
    void stopPromise.then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);
    const timers = (harness.clock?.timeouts ?? []).filter(
      (timer) => timer.ms === 5000 && !timer.cancelled,
    );
    expect(timers).toHaveLength(1);
    timers[0]?.callback();
    await stopPromise;
    expect(settled).toBe(true);
    expect(harness.processor.state).toBe('stopped');
  });

  it('(t2) stop waits on both the lead checkpoint and the saga checkpoint', async () => {
    const gate = deferred<void>();
    const harness = createHarness({
      sagas: [
        {
          name: 'hung',
          start(stint) {
            stint.scope.track(gate.promise);
          },
        },
      ],
    });
    await becomeLeader(harness);
    harness.clock?.intervals[0]?.callback();
    await flush();
    expect(harness.calls).toHaveLength(2);
    const stopPromise = harness.processor.stop();
    let settled = false;
    void stopPromise.then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);
    const timers = (harness.clock?.timeouts ?? []).filter(
      (timer) => timer.ms === 5000 && !timer.cancelled,
    );
    expect(timers).toHaveLength(2);
    timers[0]?.callback();
    await flush();
    expect(settled).toBe(false);
    timers[1]?.callback();
    await stopPromise;
    expect(settled).toBe(true);
    expect(harness.processor.state).toBe('stopped');
  });

  it('(v) logs a saga that throws on start and still starts the next one', async () => {
    const cause = new Error('saga boom');
    let secondStarted = false;
    const harness = createHarness({
      sagas: [
        {
          name: 'first',
          start() {
            throw cause;
          },
        },
        {
          name: 'second',
          start() {
            secondStarted = true;
          },
        },
      ],
    });
    await becomeLeader(harness);
    expect(secondStarted).toBe(true);
    expect(harness.errorLog).toEqual([
      {
        message: 'Task saga failed to start',
        meta: { saga: 'first', cause },
      },
    ]);
    expect(
      (harness.errorLog[0]?.meta as { cause: unknown } | undefined)?.cause,
    ).toBe(cause);
  });

  it('(w) does not start a stint when the session is logged out before the verdict', async () => {
    let starts = 0;
    const harness = createHarness({
      sagas: [
        {
          name: 'only',
          start() {
            starts += 1;
          },
        },
      ],
    });
    harness.processor.start();
    expect(harness.calls).toHaveLength(1);
    harness.setSession(loggedOut);
    harness.calls[0]?.resolve(true);
    await flush();
    expect(starts).toBe(0);
    expect(harness.processor.state).toBe('leader');
  });

  it('(x) ends the stint of an inactive leader and starts a new one on reactivation', async () => {
    const started: SagaStint[] = [];
    const activity = createActivity({ active: true });
    const harness = createHarness({
      activity: activity.activity,
      sagas: [
        {
          name: 'only',
          start(stint) {
            started.push(stint);
          },
        },
      ],
    });
    await becomeLeader(harness);
    expect(started).toHaveLength(1);
    const first = started[0];
    expect(first?.scope.alive).toBe(true);
    activity.setActive(false);
    activity.notify();
    await flush();
    expect(first?.scope.alive).toBe(false);
    expect(first?.scope.signal.aborted).toBe(true);
    expect(harness.processor.state).toBe('leader');
    expect(harness.calls).toHaveLength(1);
    activity.setActive(true);
    activity.notify();
    await flush();
    expect(harness.calls).toHaveLength(2);
    harness.calls[1]?.resolve(true);
    await flush();
    expect(started).toHaveLength(2);
    expect(started[1]).not.toBe(first);
    expect(started[1]?.scope.alive).toBe(true);
    expect(harness.processor.state).toBe('leader');
  });

  it('(y) starts no stint when a bid resolves true after the host went inactive', async () => {
    let starts = 0;
    const activity = createActivity({ active: true });
    const harness = createHarness({
      activity: activity.activity,
      sagas: [
        {
          name: 'only',
          start() {
            starts += 1;
          },
        },
      ],
    });
    harness.processor.start();
    expect(harness.calls).toHaveLength(1);
    activity.setActive(false);
    harness.calls[0]?.resolve(true);
    await flush();
    expect(starts).toBe(0);
    expect(harness.processor.state).toBe('leader');
    activity.setActive(true);
    activity.notify();
    await flush();
    expect(harness.calls).toHaveLength(2);
    harness.calls[1]?.resolve(true);
    await flush();
    expect(starts).toBe(1);
  });

  it('(z) logs a stint that fails to start and retries it on the next true verdict', async () => {
    const cause = new Error('subscribe boom');
    let failSubscribe = false;
    let starts = 0;
    const activity: ActivityMonitor = {
      isActive: () => true,
      subscribe: () => {
        if (failSubscribe) {
          throw cause;
        }
        return () => undefined;
      },
    };
    const harness = createHarness({
      activity,
      sagas: [
        {
          name: 'only',
          start() {
            starts += 1;
          },
        },
      ],
    });
    harness.processor.start();
    expect(harness.calls).toHaveLength(1);
    failSubscribe = true;
    harness.calls[0]?.resolve(true);
    await flush();
    expect(harness.processor.state).toBe('leader');
    expect(starts).toBe(0);
    expect(harness.errorLog).toEqual([
      {
        message: 'Task saga failed to start',
        meta: { saga: 'stint', cause },
      },
    ]);
    expect(
      (harness.errorLog[0]?.meta as { cause: unknown } | undefined)?.cause,
    ).toBe(cause);
    failSubscribe = false;
    harness.clock?.intervals[0]?.callback();
    await flush();
    expect(harness.calls).toHaveLength(2);
    harness.calls[1]?.resolve(true);
    await flush();
    expect(starts).toBe(1);
    expect(harness.errorLog).toHaveLength(1);
  });
});
