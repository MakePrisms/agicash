import type { AgicashDb } from '../../db/database';
import { DisposedError, NoSessionError, type SdkError } from '../../lib/error';
import type { AuthSession, Logger } from '../sdk';
import type {
  TaskProcessorApi,
  TaskProcessorState,
} from '../sdk/task-processor';
import { TaskProcessingLockRepository } from './task-processing-lock-repository';

const LEAD_POLL_INTERVAL_MS = 5_000;
const STOP_CHECKPOINT_TIMEOUT_MS = 5_000;
const LEAD_RETRY_LIMIT = 3;

type LeadBoolean = boolean;

type AttemptReason = 'mount' | 'interval' | 'resume' | 'reconnect';

export type DocumentActivity = {
  isForeground(): boolean;
  isOnline(): boolean;
  /** Fires on visibility or online/offline changes. No-op unsubscribe when there is no window. */
  subscribe(onChange: () => void): () => void;
};

export type TaskProcessorSeams = {
  takeLead?: (
    userId: string,
    clientId: string,
    options?: { abortSignal?: AbortSignal },
  ) => Promise<LeadBoolean>;
  activity?: DocumentActivity;
  randomUUID?: () => string;
  setInterval?: (callback: () => void, ms: number) => () => void;
  setTimeout?: (callback: () => void, ms: number) => () => void;
};

export type TaskProcessorDeps = {
  db: AgicashDb;
  getSession: () => AuthSession;
  emit: (payload: { state: TaskProcessorState; error?: SdkError }) => void;
  logger: Logger;
  seams?: TaskProcessorSeams;
};

type HostDocument = {
  visibilityState?: string;
};

type HostWindow = {
  addEventListener(type: string, listener: () => void, capture: boolean): void;
  removeEventListener(
    type: string,
    listener: () => void,
    capture: boolean,
  ): void;
};

function createDefaultDocumentActivity(): DocumentActivity {
  let online = true;
  let trackingOnline = false;
  return {
    isForeground(): boolean {
      const hostDocument = (globalThis as { document?: HostDocument }).document;
      if (!hostDocument || hostDocument.visibilityState === undefined) {
        return true;
      }
      return hostDocument.visibilityState !== 'hidden';
    },
    isOnline(): boolean {
      return online;
    },
    subscribe(onChange: () => void): () => void {
      const hostWindow = (globalThis as { window?: HostWindow }).window;
      if (typeof hostWindow?.addEventListener !== 'function') {
        return () => undefined;
      }
      // The flag listeners live for the activity's whole lifetime: an
      // offline/online flip between stop() and the next start() must still
      // land on the flag, or a restarted loop never attempts take_lead again.
      if (!trackingOnline) {
        trackingOnline = true;
        hostWindow.addEventListener(
          'offline',
          () => {
            online = false;
          },
          false,
        );
        hostWindow.addEventListener(
          'online',
          () => {
            online = true;
          },
          false,
        );
      }
      const forward = () => {
        onChange();
      };
      hostWindow.addEventListener('visibilitychange', forward, false);
      hostWindow.addEventListener('offline', forward, false);
      hostWindow.addEventListener('online', forward, false);
      return () => {
        hostWindow.removeEventListener('visibilitychange', forward, false);
        hostWindow.removeEventListener('offline', forward, false);
        hostWindow.removeEventListener('online', forward, false);
      };
    },
  };
}

function createRepositoryTakeLead(
  db: AgicashDb,
): NonNullable<TaskProcessorSeams['takeLead']> {
  const repository = new TaskProcessingLockRepository(db);
  return (userId, clientId, options) =>
    repository.takeLead(userId, clientId, options);
}

function defaultSchedule(
  schedule: (callback: () => void, ms: number) => unknown,
  clear: (id: unknown) => void,
): (callback: () => void, ms: number) => () => void {
  return (callback, ms) => {
    const id = schedule(callback, ms);
    return () => {
      clear(id);
    };
  };
}

class TaskProcessorRuntime {
  private current: TaskProcessorState = 'stopped';
  private failure: SdkError | undefined;
  private generation = 0;
  private clientId: string | undefined;
  private lastLead: boolean | undefined;
  private inFlight = false;
  private wasOnline = true;
  private intervalCancel: (() => void) | undefined;
  private activityUnsubscribe: (() => void) | undefined;
  private attemptAbort: AbortController | undefined;
  private cancelDelay: (() => void) | undefined;
  private runnableWaiter: (() => void) | undefined;
  private readonly checkpoints = new Set<Promise<void>>();
  private stopPromise: Promise<void> | undefined;
  private stopToken: object | undefined;

  private readonly activity: DocumentActivity;
  private readonly takeLead: NonNullable<TaskProcessorSeams['takeLead']>;
  private readonly randomUUID: () => string;
  private readonly scheduleInterval: (
    callback: () => void,
    ms: number,
  ) => () => void;
  private readonly scheduleTimeout: (
    callback: () => void,
    ms: number,
  ) => () => void;

  constructor(private readonly deps: TaskProcessorDeps) {
    const seams = deps.seams;
    this.activity = seams?.activity ?? createDefaultDocumentActivity();
    this.takeLead = seams?.takeLead ?? createRepositoryTakeLead(deps.db);
    this.randomUUID =
      seams?.randomUUID ?? (() => globalThis.crypto.randomUUID());
    this.scheduleInterval =
      seams?.setInterval ??
      defaultSchedule(
        (callback, ms) => globalThis.setInterval(callback, ms),
        (id) => {
          globalThis.clearInterval(id as ReturnType<typeof setInterval>);
        },
      );
    this.scheduleTimeout =
      seams?.setTimeout ??
      defaultSchedule(
        (callback, ms) => globalThis.setTimeout(callback, ms),
        (id) => {
          globalThis.clearTimeout(id as ReturnType<typeof setTimeout>);
        },
      );
  }

  get state(): TaskProcessorState {
    return this.current;
  }

  start(): void {
    const session = this.deps.getSession();
    if (!session.isLoggedIn) {
      throw new NoSessionError();
    }
    if (this.current === 'error') {
      throw this.failure ?? new NoSessionError();
    }
    if (this.current === 'follower' || this.current === 'leader') {
      return;
    }
    this.generation += 1;
    const generation = this.generation;
    if (this.clientId === undefined) {
      this.clientId = this.randomUUID();
    }
    this.lastLead = undefined;
    this.wasOnline = this.activity.isOnline();
    this.transition('follower');
    if (generation !== this.generation) {
      return;
    }
    this.activityUnsubscribe = this.activity.subscribe(() => {
      this.onActivity(generation);
    });
    this.intervalCancel = this.scheduleInterval(() => {
      this.tick(generation);
    }, LEAD_POLL_INTERVAL_MS);
    void this.attempt(generation, 'mount');
  }

  stop(): Promise<void> {
    if (
      this.current === 'stopped' &&
      this.intervalCancel === undefined &&
      !this.inFlight
    ) {
      return this.stopPromise ?? Promise.resolve();
    }
    this.generation += 1;
    this.inFlight = false;
    this.intervalCancel?.();
    this.intervalCancel = undefined;
    this.activityUnsubscribe?.();
    this.activityUnsubscribe = undefined;
    this.attemptAbort?.abort();
    this.attemptAbort = undefined;
    this.cancelDelay?.();
    this.wakeRunnableWaiter();
    this.transition('stopped');
    this.lastLead = undefined;

    const token = {};
    this.stopToken = token;
    const snapshot = [...this.checkpoints].map((work) =>
      work.then(
        () => undefined,
        () => undefined,
      ),
    );
    let finished = false;
    const promise = new Promise<void>((resolve) => {
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        if (this.stopToken === token) {
          this.stopPromise = undefined;
          this.stopToken = undefined;
        }
        resolve();
      };
      const cancelTimer = this.scheduleTimeout(
        finish,
        STOP_CHECKPOINT_TIMEOUT_MS,
      );
      void Promise.all(snapshot).then(() => {
        cancelTimer();
        finish();
      });
    });
    this.stopPromise = promise;
    return promise;
  }

  private transition(next: TaskProcessorState, error?: SdkError): void {
    if (next === this.current && next !== 'error') {
      return;
    }
    this.current = next;
    this.failure = next === 'error' ? error : undefined;
    if (next === 'error') {
      this.deps.emit({ state: 'error', error });
      return;
    }
    this.deps.emit({ state: next });
  }

  private onActivity(generation: number): void {
    if (generation !== this.generation || this.current === 'stopped') {
      return;
    }
    const online = this.activity.isOnline();
    const reconnect = !this.wasOnline && online;
    this.wasOnline = online;
    this.wakeIfRunnable();
    this.kick(generation, reconnect ? 'reconnect' : 'resume');
  }

  private tick(generation: number): void {
    if (generation !== this.generation || this.current === 'stopped') {
      return;
    }
    this.wakeIfRunnable();
    this.kick(generation, 'interval');
  }

  private kick(
    generation: number,
    reason: Exclude<AttemptReason, 'mount'>,
  ): void {
    if (reason === 'reconnect') {
      if (this.activity.isOnline() && !this.inFlight) {
        void this.attempt(generation, reason);
      }
      return;
    }
    if (this.isRunnable() && !this.inFlight) {
      void this.attempt(generation, reason);
    }
  }

  private isRunnable(): boolean {
    return this.activity.isForeground() && this.activity.isOnline();
  }

  private isLoopCurrent(generation: number): boolean {
    return generation === this.generation && this.current !== 'stopped';
  }

  private wakeIfRunnable(): void {
    if (this.isRunnable()) {
      this.wakeRunnableWaiter();
    }
  }

  private wakeRunnableWaiter(): void {
    const waiter = this.runnableWaiter;
    this.runnableWaiter = undefined;
    waiter?.();
  }

  private async attempt(
    generation: number,
    reason: AttemptReason,
  ): Promise<void> {
    if (generation !== this.generation || this.current === 'stopped') {
      return;
    }
    this.inFlight = true;
    const controller = new AbortController();
    this.attemptAbort = controller;
    try {
      let session: AuthSession;
      try {
        session = this.deps.getSession();
      } catch (error) {
        if (error instanceof DisposedError) {
          void this.stop();
          return;
        }
        throw error;
      }
      if (!session.isLoggedIn) {
        void this.stop();
        return;
      }
      if (reason === 'mount' && !this.activity.isOnline()) {
        return;
      }
      if (
        (reason === 'interval' || reason === 'resume') &&
        !this.isRunnable()
      ) {
        return;
      }
      const clientId = this.clientId;
      if (clientId === undefined) {
        return;
      }
      const userId = session.user.id;
      let failureCount = 0;
      while (this.isLoopCurrent(generation) && !controller.signal.aborted) {
        try {
          const lead = await this.track(
            this.takeLead(userId, clientId, {
              abortSignal: controller.signal,
            }),
          );
          if (generation !== this.generation || controller.signal.aborted) {
            return;
          }
          this.applyLead(lead, clientId);
          return;
        } catch (error) {
          if (controller.signal.aborted || generation !== this.generation) {
            return;
          }
          if (failureCount >= LEAD_RETRY_LIMIT) {
            this.deps.logger.warn(
              'Error. Take lead request failed. Will retry in 5 seconds.',
              { cause: error },
            );
            return;
          }
          await this.delay(Math.min(1000 * 2 ** failureCount, 30_000));
          if (!this.isLoopCurrent(generation)) {
            return;
          }
          failureCount += 1;
          const stillRunning = await this.parkUntilRunnable(generation);
          if (!stillRunning) {
            return;
          }
        }
      }
    } finally {
      if (this.generation === generation) {
        this.inFlight = false;
        if (this.attemptAbort === controller) {
          this.attemptAbort = undefined;
        }
      }
    }
  }

  private applyLead(lead: boolean, clientId: string): void {
    if (lead === this.lastLead) {
      return;
    }
    this.lastLead = lead;
    if (lead) {
      this.deps.logger.debug('Taking lead on task processing', { clientId });
    } else {
      this.deps.logger.debug('Yielded lead on task processing', { clientId });
    }
    this.transition(lead ? 'leader' : 'follower');
  }

  private track<T>(work: Promise<T>): Promise<T> {
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    this.checkpoints.add(settled);
    void settled.then(() => {
      this.checkpoints.delete(settled);
    });
    return work;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        this.cancelDelay = undefined;
        resolve();
      };
      const cancelTimer = this.scheduleTimeout(finish, ms);
      this.cancelDelay = () => {
        cancelTimer();
        finish();
      };
    });
  }

  private waitUntilRunnable(generation: number): Promise<void> {
    if (
      generation !== this.generation ||
      this.current === 'stopped' ||
      this.isRunnable()
    ) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.runnableWaiter = () => {
        this.runnableWaiter = undefined;
        resolve();
      };
    });
  }

  private async parkUntilRunnable(generation: number): Promise<boolean> {
    while (generation === this.generation && this.current !== 'stopped') {
      if (this.isRunnable()) {
        return true;
      }
      await this.waitUntilRunnable(generation);
    }
    return false;
  }
}

export function createTaskProcessor(deps: TaskProcessorDeps): TaskProcessorApi {
  const runtime = new TaskProcessorRuntime(deps);
  return {
    start: () => runtime.start(),
    stop: () => runtime.stop(),
    get state() {
      return runtime.state;
    },
  };
}
