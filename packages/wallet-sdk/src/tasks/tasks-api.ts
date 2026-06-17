import { type QueryClient, QueryObserver } from '@tanstack/query-core';
import type { TaskProcessingLockRepository } from '../task-processing-lock-repository';
import type { SagaProcessor } from './processor';

/**
 * The engine's lifecycle status.
 * - `stopped`: before {@link TasksApi.start} or after {@link TasksApi.stop}.
 * - `follower`: election is running but another client holds the lease (sagas idle).
 * - `leader`: this client holds the lease (sagas run while leader).
 * - `error`: the leader-election poll is failing.
 */
export type TasksStatus = 'stopped' | 'follower' | 'leader' | 'error';

export type TasksStartOptions = {
  /**
   * The client identity used for leader election. Defaults to a random UUID
   * minted once per engine instance (a reload mints a new one, so there is up
   * to one lease-TTL of no-processing after a refresh until the old lease
   * expires). A headless daemon can pass a stable per-daemon id.
   */
  clientId?: string;
};

export type TasksApi = {
  /**
   * Starts leader election. While the lease is held the status is `leader`;
   * otherwise `follower`. Idempotent — a second call while already running is a
   * no-op. Must only be called client-side (it constructs a query-core
   * observer); never at SDK config time.
   */
  start: (opts?: TasksStartOptions) => void;
  /**
   * Stops leader election and resets the status to `stopped`. The DB lease is
   * not actively released; it expires on its own. Idempotent.
   */
  stop: () => void;
  /** The current lifecycle status. */
  getStatus: () => TasksStatus;
  /** Subscribes to status changes. Returns the unsubscribe function. */
  onStatusChange: (listener: () => void) => () => void;
  /** The last leader-election error, if the status is `error`. */
  getError: () => Error | null;
};

export type TasksApiDeps = {
  /** The SDK's single query-core client (drives the leader-election observer). */
  queryClient: QueryClient;
  /** The leader-election lock repository (RPC `take_lead`, 6s lease). */
  taskProcessingLockRepository: TaskProcessingLockRepository;
  /**
   * Resolves the current user's id from the SDK's user state.
   * @throws if no user is loaded yet.
   */
  getCurrentUserId: () => string;
  /**
   * The saga-family processors. Each is activated while this client is the
   * leader and deactivated otherwise.
   */
  processors: SagaProcessor[];
};

/**
 * The background task-processing engine. It runs leader election (the
 * `take_lead` poll) and, while this client holds the lease, runs the registered
 * saga processors. start/stop/status are exposed as an imperative lifecycle a
 * host drives (the web app today, a headless daemon later).
 */
export function createTasksApi(deps: TasksApiDeps): TasksApi {
  const {
    queryClient,
    taskProcessingLockRepository,
    getCurrentUserId,
    processors,
  } = deps;

  let status: TasksStatus = 'stopped';
  let error: Error | null = null;
  let observer: QueryObserver<boolean> | null = null;
  let unsubscribeObserver: (() => void) | null = null;
  let processorsActive = false;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  // The reconciler-while-leader gate: run the registered families only while
  // this client holds the lease (status 'leader'); tear them down on any other
  // status (follower/stopped/error). Idempotent in both directions.
  const reconcileProcessors = () => {
    const shouldBeActive = status === 'leader';
    if (shouldBeActive === processorsActive) {
      return;
    }
    processorsActive = shouldBeActive;
    for (const processor of processors) {
      if (shouldBeActive) {
        processor.activate();
      } else {
        processor.deactivate();
      }
    }
  };

  const setState = (nextStatus: TasksStatus, nextError: Error | null) => {
    if (status === nextStatus && error === nextError) {
      return;
    }
    status = nextStatus;
    error = nextError;
    reconcileProcessors();
    notify();
  };

  return {
    start: (opts) => {
      // Idempotent: a second start while running keeps the existing election.
      if (observer) {
        return;
      }

      const clientId = opts?.clientId ?? crypto.randomUUID();

      // The 5s renew poll keeps the 6s DB lease alive; on expiry another client
      // steals it.
      observer = new QueryObserver<boolean>(queryClient, {
        enabled: !!clientId,
        queryKey: ['take-lead', clientId],
        queryFn: () =>
          taskProcessingLockRepository.takeLead(getCurrentUserId(), clientId),
        refetchInterval: 5000,
        refetchIntervalInBackground: false,
      });

      unsubscribeObserver = observer.subscribe((result) => {
        if (result.error) {
          console.warn(
            'Error. Take lead request failed. Will retry in 5 seconds.',
            { cause: result.error },
          );
          setState('error', result.error as Error);
          return;
        }
        // data === true => we hold the lease; false or undefined (not yet
        // settled) => we do not hold the lease.
        setState(result.data === true ? 'leader' : 'follower', null);
      });

      // Reflect the observer's current (likely pending) result immediately so a
      // synchronous getStatus() after start() is consistent.
      const initial = observer.getCurrentResult();
      if (initial.error) {
        setState('error', initial.error as Error);
      } else {
        setState(initial.data === true ? 'leader' : 'follower', null);
      }
    },
    stop: () => {
      unsubscribeObserver?.();
      unsubscribeObserver = null;
      observer?.destroy();
      observer = null;
      setState('stopped', null);
    },
    getStatus: () => status,
    onStatusChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getError: () => error,
  };
}
