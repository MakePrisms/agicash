import { describe, expect, it } from 'bun:test';
import type { AgicashDb } from '../../db/database';
import {
  DisposedError,
  NoSessionError,
  NotImplementedError,
} from '../../lib/error';
import { nullLogger } from '../../lib/logger';
import type {
  AuthKeyValueStore,
  AuthSession,
  Logger,
  SdkConfig,
  TaskProcessorState,
} from '../sdk';
import { AgicashSdk } from '../sdk/sdk';
import {
  type DocumentActivity,
  type TaskProcessorDeps,
  type TaskProcessorSeams,
  createTaskProcessor,
} from './task-processor-runtime';

const CLIENT_A = '00000000-0000-4000-8000-000000000001';
const CLIENT_B = '00000000-0000-4000-8000-000000000002';

const loggedIn = {
  isLoggedIn: true,
  user: { id: 'user-1' },
} as AuthSession;

const loggedOut: AuthSession = { isLoggedIn: false };

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

function createRecordingClock(): {
  intervals: RecordedTimer[];
  timeouts: RecordedTimer[];
  setInterval: NonNullable<TaskProcessorSeams['setInterval']>;
  setTimeout: NonNullable<TaskProcessorSeams['setTimeout']>;
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

function createActivity(initial: { foreground: boolean; online?: boolean }): {
  activity: DocumentActivity;
  setForeground: (value: boolean) => void;
  setOnline: (value: boolean) => void;
  notify: () => void;
} {
  let foreground = initial.foreground;
  let online = initial.online ?? true;
  let listener: (() => void) | undefined;
  return {
    activity: {
      isForeground: () => foreground,
      isOnline: () => online,
      subscribe: (onChange) => {
        listener = onChange;
        return () => {
          if (listener === onChange) {
            listener = undefined;
          }
        };
      },
    },
    setForeground: (value) => {
      foreground = value;
    },
    setOnline: (value) => {
      online = value;
    },
    notify: () => {
      listener?.();
    },
  };
}

function createHarness(options?: {
  session?: AuthSession;
  takeLead?: TaskProcessorSeams['takeLead'];
  activity?: DocumentActivity;
  db?: AgicashDb;
  clock?: boolean;
  randomUUID?: boolean;
}): {
  processor: ReturnType<typeof createTaskProcessor>;
  calls: LeadCall[];
  emits: Emit[];
  debugLog: Array<{ message: string; meta: unknown }>;
  warnLog: Array<{ message: string; meta: unknown }>;
  clock: ReturnType<typeof createRecordingClock> | undefined;
  uuidCount: () => number;
  setSession: (session: AuthSession) => void;
} {
  const calls: LeadCall[] = [];
  const emits: Emit[] = [];
  const debugLog: Array<{ message: string; meta: unknown }> = [];
  const warnLog: Array<{ message: string; meta: unknown }> = [];
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
    error: () => undefined,
  };
  const seams: TaskProcessorSeams = {
    takeLead,
  };
  if (options?.activity) {
    seams.activity = options.activity;
  }
  if (clock) {
    seams.setInterval = clock.setInterval;
    seams.setTimeout = clock.setTimeout;
  }
  if (options?.randomUUID !== false) {
    seams.randomUUID = () => {
      const id = uuids[uuidCount] ?? CLIENT_B;
      uuidCount += 1;
      return id;
    };
  }
  const deps: TaskProcessorDeps = {
    db: options?.db ?? ({} as AgicashDb),
    getSession: () => session,
    emit: (payload) => {
      emits.push(payload);
    },
    logger,
    seams,
  };
  return {
    processor: createTaskProcessor(deps),
    calls,
    emits,
    debugLog,
    warnLog,
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

  it('(e) keeps a hidden leader and refetches once it is visible again', async () => {
    const activity = createActivity({ foreground: true });
    const harness = createHarness({ activity: activity.activity });
    await becomeLeader(harness);
    activity.setForeground(false);
    harness.clock?.intervals[0]?.callback();
    await flush();
    expect(harness.calls).toHaveLength(1);
    expect(harness.processor.state).toBe('leader');
    activity.setForeground(true);
    activity.notify();
    await flush();
    expect(harness.calls).toHaveLength(2);
    harness.calls[1]?.resolve(false);
    await flush();
    expect(harness.processor.state).toBe('follower');
  });

  it('(f) attempts on mount while hidden and skips the hidden interval', async () => {
    const activity = createActivity({ foreground: false });
    const harness = createHarness({ activity: activity.activity });
    harness.processor.start();
    expect(harness.calls).toHaveLength(1);
    harness.calls[0]?.resolve(true);
    await flush();
    expect(harness.processor.state).toBe('leader');
    harness.clock?.intervals[0]?.callback();
    await flush();
    expect(harness.calls).toHaveLength(1);
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

  it('(h) keeps a parked retry parked through a hidden interval tick', async () => {
    const activity = createActivity({ foreground: true });
    const harness = createHarness({ activity: activity.activity });
    await becomeLeader(harness);
    harness.clock?.intervals[0]?.callback();
    await flush();
    harness.calls[1]?.reject(new Error('db down'));
    await flush();
    const delay = latestTimeout(harness.clock?.timeouts ?? [], 1000);
    delay.callback();
    activity.setForeground(false);
    await flush();
    expect(harness.calls).toHaveLength(2);
    harness.clock?.intervals[0]?.callback();
    await flush();
    expect(harness.calls).toHaveLength(2);
    activity.setForeground(true);
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
    expect(harness.processor.state).not.toBe('leader');
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
    const activity = createActivity({ foreground: true });
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
    const db = {
      rpc(fn: string, args: unknown) {
        rpcCalls.push({ fn, args });
        const result = Promise.resolve({ data: true, error: null });
        return Object.assign(result, {
          abortSignal() {
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
      emit: () => undefined,
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      seams: {
        randomUUID: () => {
          uuidCount += 1;
          return uuidCount === 1 ? CLIENT_A : CLIENT_B;
        },
        setInterval: clock.setInterval,
        setTimeout: clock.setTimeout,
      },
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
    await processor.stop();
  });

  it('(o) treats a missing document as foreground', async () => {
    if ((globalThis as { document?: unknown }).document !== undefined) {
      return;
    }
    const harness = createHarness();
    harness.processor.start();
    expect(harness.calls).toHaveLength(1);
    harness.calls[0]?.resolve(true);
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

  it('(q) an idle offline-to-online flip renews while hidden', async () => {
    const activity = createActivity({ foreground: true, online: true });
    const harness = createHarness({ activity: activity.activity });
    await becomeLeader(harness);
    activity.setForeground(false);
    activity.setOnline(false);
    activity.notify();
    await flush();
    expect(harness.calls).toHaveLength(1);
    activity.setOnline(true);
    activity.notify();
    await flush();
    expect(harness.calls).toHaveLength(2);
    harness.calls[1]?.resolve(true);
    await flush();
    expect(harness.processor.state).toBe('leader');
    expect(
      harness.emits.filter((payload) => payload.state === 'leader'),
    ).toHaveLength(1);
    expect(harness.debugLog).toHaveLength(1);
  });
});
