import { nullLogger } from '../../lib/logger';
import {
  type RunScope,
  type ScopeClock,
  createRunScopes,
} from '../../lib/run-scope';
import type { Account } from '../accounts/account';
import type { ActivityMonitor, Logger } from '../sdk';
import { WalletEventEmitter } from '../sdk/events';
import {
  type KeyedSerialQueue,
  type SagaStint,
  createKeyedSerialQueue,
  createSagaStint,
} from './task-saga';

export type RecordedTimer = {
  ms: number;
  callback: () => void;
  cancel: () => void;
  cancelled: boolean;
};

export function createRecordingClock(): ScopeClock & {
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

export function createFakeActivity(initial: { active: boolean }): {
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

export type RecordingLogger = Logger & {
  debugLog: Array<{ message: string; meta: unknown }>;
  infoLog: Array<{ message: string; meta: unknown }>;
  warnLog: Array<{ message: string; meta: unknown }>;
  errorLog: Array<{ message: string; meta: unknown }>;
};

export function createRecordingLogger(): RecordingLogger {
  const debugLog: RecordingLogger['debugLog'] = [];
  const infoLog: RecordingLogger['infoLog'] = [];
  const warnLog: RecordingLogger['warnLog'] = [];
  const errorLog: RecordingLogger['errorLog'] = [];
  return {
    debugLog,
    infoLog,
    warnLog,
    errorLog,
    debug: (message, meta) => {
      debugLog.push({ message, meta });
    },
    info: (message, meta) => {
      infoLog.push({ message, meta });
    },
    warn: (message, meta) => {
      warnLog.push({ message, meta });
    },
    error: (message, meta) => {
      errorLog.push({ message, meta });
    },
  };
}

export type LoadAccountCall = {
  userId: string;
  signal: AbortSignal;
};

export function createTestStint(options?: {
  userId?: string;
  queue?: KeyedSerialQueue;
  clock?: ReturnType<typeof createRecordingClock>;
  activity?: ReturnType<typeof createFakeActivity>;
  events?: WalletEventEmitter;
  loadAccounts?: (userId: string, signal: AbortSignal) => Promise<Account[]>;
}): {
  stint: SagaStint;
  scope: RunScope;
  cancel: () => void;
  clock: ReturnType<typeof createRecordingClock>;
  activity: ReturnType<typeof createFakeActivity>;
  events: WalletEventEmitter;
  logger: RecordingLogger;
  loadAccountCalls: LoadAccountCall[];
  setNow: (value: number) => void;
} {
  const clock = options?.clock ?? createRecordingClock();
  const activity = options?.activity ?? createFakeActivity({ active: true });
  const events = options?.events ?? new WalletEventEmitter(nullLogger);
  const logger = createRecordingLogger();
  const scopes = createRunScopes(clock);
  const scope = scopes.renew();
  const loadAccountCalls: LoadAccountCall[] = [];
  const loadAccounts =
    options?.loadAccounts ??
    ((_userId: string, _signal: AbortSignal) => Promise.resolve([]));
  let now = 0;
  const stint = createSagaStint({
    scope,
    userId: options?.userId ?? 'user-1',
    events: {
      on: (event, handler) => events.on(event, handler),
      emit: (message) => events.emit(message.event, message.payload as never),
    },
    activity: activity.activity,
    loadAccounts: (userId, signal) => {
      loadAccountCalls.push({ userId, signal });
      return loadAccounts(userId, signal);
    },
    queue: options?.queue ?? createKeyedSerialQueue(),
    logger,
    now: () => now,
  });
  return {
    stint,
    scope,
    cancel: () => {
      scopes.cancel();
    },
    clock,
    activity,
    events,
    logger,
    loadAccountCalls,
    setNow: (value) => {
      now = value;
    },
  };
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Awaits a macrotask so queued microtasks run. */
export function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
