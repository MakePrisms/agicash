import type { AgicashDb } from '../../db/database';
import { DisposedError, NoSessionError, type SdkError } from '../../lib/error';
import {
  type RunScope,
  type RunScopes,
  type ScopeClock,
  createRunScopes,
} from '../../lib/run-scope';
import type { ActivityMonitor, AuthSession, Logger } from '../sdk';
import type {
  TaskProcessorApi,
  TaskProcessorState,
} from '../sdk/task-processor';
import { TaskProcessingLockRepository } from './task-processing-lock-repository';

const LEAD_POLL_INTERVAL_MS = 5_000;
const STOP_CHECKPOINT_TIMEOUT_MS = 5_000;
const LEAD_RETRY_LIMIT = 3;

type TakeLead = (
  userId: string,
  clientId: string,
  options?: { abortSignal?: AbortSignal },
) => Promise<boolean>;

export type TaskProcessorDeps = {
  db: AgicashDb;
  getSession: () => AuthSession;
  activity: ActivityMonitor;
  emit: (payload: { state: TaskProcessorState; error?: SdkError }) => void;
  logger: Logger;
  /** Test seam; defaults to `TaskProcessingLockRepository.takeLead` on `db`. */
  takeLead?: TakeLead;
  /** Test seam; defaults to `globalThis.crypto.randomUUID`. */
  randomUUID?: () => string;
  /** Test seam; defaults to the global `setInterval` / `setTimeout`. */
  clock?: ScopeClock;
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

function createRepositoryTakeLead(db: AgicashDb): TakeLead {
  const repository = new TaskProcessingLockRepository(db);
  return (userId, clientId, options) =>
    repository.takeLead(userId, clientId, options);
}

/**
 * Elects this client as the user's task-processing leader and keeps the lease.
 *
 * Leadership lives in one row per user (`wallet.task_processing_locks`), and
 * the `take_lead` RPC is the mutex: it renews the lease of the client that
 * holds it, gives an expired lease to the caller, and refuses otherwise. So at
 * most one client id holds an unexpired lease (6 s) at any time, whatever the
 * clients do. This class only decides WHEN to call `take_lead`: right after
 * `start()`, every 5 s, and on every activity change — and only while the
 * host reports `isActive()`. An inactive client stops renewing, its lease
 * expires, and an active client takes over on its next call.
 *
 * `state` holds the latest verdict ('leader' or 'follower'), and each change
 * is emitted as `task-processor.state-changed`. Each start-to-stop generation
 * runs in its own `RunScope`, so a late `take_lead` response from a stopped
 * generation can never change `state`. The client id is minted once per
 * instance and survives `stop()`/`start()`.
 */
class TaskProcessorRuntime {
  private current: TaskProcessorState = 'stopped';
  private failure: SdkError | undefined;
  private clientId: string | undefined;
  private lastLead: boolean | undefined;
  private inFlight = false;

  private readonly scopes: RunScopes;
  private readonly activity: ActivityMonitor;
  private readonly takeLead: TakeLead;
  private readonly randomUUID: () => string;

  constructor(private readonly deps: TaskProcessorDeps) {
    this.activity = deps.activity;
    this.takeLead = deps.takeLead ?? createRepositoryTakeLead(deps.db);
    this.randomUUID = deps.randomUUID ?? (() => globalThis.crypto.randomUUID());
    this.scopes = createRunScopes(deps.clock ?? systemClock);
  }

  get state(): TaskProcessorState {
    return this.current;
  }

  /**
   * Starts the lead loop: subscribes to activity changes, arms the 5 s
   * interval, and bids at once. Synchronous: `state` becomes 'follower'
   * immediately (and is emitted), and the first verdict arrives later.
   *
   * Idempotent while the loop runs ('follower' or 'leader'). After `stop()`
   * it starts a new generation with the same client id, so the new loop
   * renews the lease the old one held instead of waiting for it to expire.
   *
   * @throws {NoSessionError} when no user is logged in.
   * @throws {DisposedError} after the SDK is disposed.
   * @throws {SdkError} the error that put the processor in 'error', while it
   * stays there.
   */
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
    const scope = this.scopes.renew();
    if (this.clientId === undefined) {
      this.clientId = this.randomUUID();
    }
    this.lastLead = undefined;
    this.transition('follower');
    if (!scope.alive) {
      return;
    }
    const bid = () => {
      void this.bidForLead(scope);
    };
    const unsubscribe = this.activity.subscribe(bid);
    scope.onCleanup(unsubscribe);
    scope.every(LEAD_POLL_INTERVAL_MS, bid);
    bid();
  }

  /**
   * Stops the lead loop. Everything that matters happens synchronously,
   * before the first await: the scope is cancelled (the interval, the
   * activity subscription, and pending retry delays go away, and the
   * in-flight `take_lead` is aborted), `state` becomes 'stopped', and no new
   * bid can start. The lock row is not written; the lease simply expires
   * (6 s), and another client takes over.
   *
   * The returned promise resolves when the tracked in-flight work settles,
   * or after 5 s, whichever is first, and it never rejects. Await it when
   * the instance must be quiet before the next step (a controlled
   * shutdown); a caller that only needs the loop gone (sign-out) need not.
   * Safe to call any number of times, from any state.
   */
  stop(): Promise<void> {
    this.scopes.cancel();
    this.inFlight = false;
    this.transition('stopped');
    this.lastLead = undefined;
    return this.scopes.join(STOP_CHECKPOINT_TIMEOUT_MS);
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

  /**
   * One leadership bid: a single logical take_lead acquisition-or-renewal,
   * including transport retries (1s/2s/4s, then one warn until the next tick).
   * Every trigger (start, the 5s interval, an activity change) calls this; it
   * is a no-op when the scope is dead, a bid is already in flight, or the
   * host is inactive. A bid that finds the host inactive after a backoff is
   * abandoned; the next activation starts a fresh one. Ends by applying a
   * verdict, by being abandoned, or by evaporating when the scope dies.
   */
  private async bidForLead(scope: RunScope): Promise<void> {
    if (!scope.alive || this.inFlight || !this.activity.isActive()) {
      return;
    }
    this.inFlight = true;
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
      const clientId = this.clientId;
      if (clientId === undefined) {
        return;
      }
      const userId = session.user.id;
      let failureCount = 0;
      while (scope.alive) {
        try {
          const lead = await scope.track(
            this.takeLead(userId, clientId, { abortSignal: scope.signal }),
          );
          if (!scope.alive) {
            return;
          }
          this.applyLead(lead, clientId);
          return;
        } catch (error) {
          if (!scope.alive) {
            return;
          }
          if (failureCount >= LEAD_RETRY_LIMIT) {
            this.deps.logger.warn(
              'Error. Take lead request failed. Will retry in 5 seconds.',
              { cause: error },
            );
            return;
          }
          await scope.delay(Math.min(1000 * 2 ** failureCount, 30_000));
          if (!scope.alive || !this.activity.isActive()) {
            return;
          }
          failureCount += 1;
        }
      }
    } finally {
      if (scope.alive) {
        this.inFlight = false;
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
}

/**
 * Implements `TaskProcessorApi` with `TaskProcessorRuntime`. The returned
 * facade exposes only the contract members (`start`, `stop`, `state`).
 */
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
