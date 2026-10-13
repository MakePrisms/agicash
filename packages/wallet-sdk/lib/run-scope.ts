/**
 * A small structured-concurrency primitive for cancellable long-running
 * loops: code that alternates awaited I/O and sleeps, and that an owner must
 * be able to shut down cleanly at any moment.
 *
 * ## The model
 *
 * A controller (`RunScopes`) owns at most ONE live generation at a time. Each
 * `renew()` cancels the previous generation and mints a fresh `RunScope` — a
 * capability handle the loop threads through its awaits. `cancel()` kills the
 * live generation. Every timer, listener, sleep, and abort signal a loop
 * needs is obtained FROM its scope, so the controller can take all of them
 * down in one synchronous stroke.
 *
 * Two rules give the primitive its shape:
 *
 * 1. **Cancellation is synchronous and silent.** `cancel()` marks the scope
 *    dead, aborts its signal, clears its timers, runs its cleanups, and
 *    releases every pending `delay` by RESOLVING it — never by rejecting. A
 *    cancelled loop therefore resumes normally, observes
 *    `scope.alive === false`, and returns. No error plumbing, no unhandled
 *    rejections, no special cases: the loop body stays a plain sequence of
 *    awaits with one `if (!scope.alive) return;` after each.
 * 2. **Scope identity is the fence.** A continuation keeps the scope object
 *    it started under. Once `renew()` or `cancel()` runs, that object is dead
 *    forever; a continuation resumed late (a slow response, a fired timer)
 *    holds proof of its own staleness and cannot act on behalf of a newer
 *    generation. This closes the classic "late response resurrects stopped
 *    state" race without comparing generation counters at every step.
 *
 * ## The canonical consumer
 *
 * ```ts
 * const scopes = createRunScopes(clock);
 *
 * function start() {
 *   const scope = scopes.renew();
 *   const kick = () => {
 *     if (readyToWork()) void iterate(scope);
 *   };
 *   const unsubscribe = source.subscribe(kick);
 *   scope.onCleanup(unsubscribe);
 *   scope.every(POLL_MS, kick);
 *   kick();
 * }
 *
 * async function iterate(scope: RunScope) {
 *   while (scope.alive) {
 *     try {
 *       const result = await scope.track(io({ signal: scope.signal }));
 *       if (!scope.alive) return;
 *       apply(result);
 *       return;
 *     } catch (error) {
 *       if (!scope.alive) return;
 *       await scope.delay(backoffMs());
 *       if (!scope.alive || !readyToWork()) return; // the next kick restarts
 *     }
 *   }
 * }
 *
 * async function stop() {
 *   scopes.cancel();                 // synchronous: nothing new starts
 *   await scopes.join(BOUND_MS);     // bounded: in-flight work settles
 * }
 * ```
 *
 * The task-processor lead poll is one consumer of this shape; the per-flow
 * task-processing sagas and the SDK-owned realtime feed are the next ones.
 *
 * ## Non-goals
 *
 * This is not a task queue and not a scheduler: it runs nothing by itself and
 * holds no work items. It has no error channel: `track` observes only
 * COMPLETION, and errors stay with the caller, who awaits the original
 * promise. It has no "wait until a condition holds" primitive: a loop that
 * cannot proceed returns, and its next trigger starts a fresh iteration. That
 * keeps no in-memory continuation alive across a change of conditions, which
 * is correct when the loop's real state is durable (a database row, a lock
 * row) and restarting is cheap. A controller holds one live scope; a consumer
 * that needs several independent lifetimes (say, one per leadership stint)
 * creates several controllers.
 */

type Cancel = () => void;

/**
 * The timer source, injected so tests can drive time by hand; production
 * passes thin wrappers over the global `setInterval`/`setTimeout`. Each call
 * arms exactly one timer and returns the canceller for that one timer.
 * Cancelling an already-fired or already-cancelled timer must be a no-op.
 */
export type ScopeClock = {
  setInterval(callback: () => void, ms: number): Cancel;
  setTimeout(callback: () => void, ms: number): Cancel;
};

export type RunScope = {
  /**
   * False from the moment `cancel()`/`renew()` runs, forever. The fence:
   * check it after EVERY await, and return when it is false. Nothing a dead
   * scope's continuation does through the scope has any effect.
   */
  readonly alive: boolean;
  /**
   * Aborted when the scope dies. Pass it into I/O (fetch, PostgREST) so
   * cancellation reaches the wire. It is advisory — an implementation may
   * ignore it — which is exactly what `join`'s bound exists to cover.
   */
  readonly signal: AbortSignal;
  /**
   * Sleep bound to the scope. On cancel it clears its timer and resolves
   * EARLY — never rejects — per rule 1: the woken continuation sees
   * `alive === false` and returns on its own.
   */
  delay(ms: number): Promise<void>;
  /**
   * Register `work` with the controller's checkpoint set — the set `join`
   * waits on — and pass the same promise back, so the natural call shape is
   * `await scope.track(io(...))`. The tracked copy swallows rejections,
   * because tracking is about completion, not results: the caller still
   * awaits the original promise and owns its errors. Tracked entries remove
   * themselves when they settle. They deliberately OUTLIVE the scope: `join`
   * runs after `cancel`, when the work it waits for belongs to an
   * already-dead generation.
   */
  track<T>(work: Promise<T>): Promise<T>;
  /**
   * An interval that dies with the scope. On an already-dead scope this is a
   * no-op — nothing is armed.
   */
  every(ms: number, callback: () => void): void;
  /**
   * Register teardown to run at cancel — typically a listener unsubscribe.
   * On an already-dead scope the cleanup runs immediately instead of
   * leaking.
   */
  onCleanup(cleanup: Cancel): void;
};

export type RunScopes = {
  /** Cancel the live generation (if any) and mint the next one. */
  renew(): RunScope;
  /**
   * Kill the live generation synchronously: mark it dead, abort its signal,
   * run its cleanups, clear its intervals, release its pending delays.
   * Idempotent, and a no-op when nothing is live. After it returns,
   * no new work can start under the old generation; `join` is the separate,
   * asynchronous question of when already-started work finishes.
   */
  cancel(): void;
  /**
   * Wait for every tracked piece of work to settle, bounded by `boundMs`.
   * Resolves — never rejects — when the checkpoints settle or the bound
   * fires, whichever is first; the bound's timer is cancelled when the work
   * wins. Work still unsettled when the bound fires is ABANDONED: purged
   * from the checkpoint set, so one hung request delays one `join`, not
   * every later one. Abandonment is safe because abandoned work is fenced
   * (rule 2) — it can waste only itself. Concurrent callers share the
   * pending join; with nothing tracked, `join` resolves immediately.
   */
  join(boundMs: number): Promise<void>;
};

type ScopeState = {
  alive: boolean;
  controller: AbortController;
  cleanups: Cancel[];
  /**
   * Releases of the delays still pending: each cancels its timer and resolves
   * early. A delay that fires normally removes its own entry.
   */
  releases: Set<Cancel>;
};

export function createRunScopes(clock: ScopeClock): RunScopes {
  // Shared across generations on purpose: see RunScope.track.
  const checkpoints = new Set<Promise<void>>();
  let live: ScopeState | undefined;
  let pendingJoin: Promise<void> | undefined;

  const kill = (scope: ScopeState) => {
    scope.alive = false;
    for (const cleanup of scope.cleanups) {
      cleanup();
    }
    scope.cleanups = [];
    scope.controller.abort();
    for (const release of [...scope.releases]) {
      release();
    }
    scope.releases.clear();
  };

  const cancel = () => {
    if (live) {
      const dying = live;
      live = undefined;
      kill(dying);
    }
  };

  const renew = (): RunScope => {
    cancel();
    const state: ScopeState = {
      alive: true,
      controller: new AbortController(),
      cleanups: [],
      releases: new Set(),
    };
    live = state;

    return {
      get alive() {
        return state.alive;
      },
      get signal() {
        return state.controller.signal;
      },
      delay(ms) {
        if (!state.alive) {
          return Promise.resolve();
        }
        return new Promise((resolve) => {
          let cancelTimer: Cancel | undefined;
          const release = () => {
            state.releases.delete(release);
            cancelTimer?.();
            resolve();
          };
          state.releases.add(release);
          cancelTimer = clock.setTimeout(() => {
            cancelTimer = undefined;
            release();
          }, ms);
        });
      },
      track(work) {
        const settled = work.then(
          () => undefined,
          () => undefined,
        );
        checkpoints.add(settled);
        void settled.then(() => {
          checkpoints.delete(settled);
        });
        return work;
      },
      every(ms, callback) {
        if (!state.alive) {
          return;
        }
        state.cleanups.push(clock.setInterval(callback, ms));
      },
      onCleanup(cleanup) {
        if (!state.alive) {
          cleanup();
          return;
        }
        state.cleanups.push(cleanup);
      },
    };
  };

  const join = (boundMs: number): Promise<void> => {
    if (pendingJoin) {
      return pendingJoin;
    }
    const snapshot = [...checkpoints];
    if (snapshot.length === 0) {
      return Promise.resolve();
    }
    const promise = new Promise<void>((resolve) => {
      let finished = false;
      const finish = (abandoned: boolean) => {
        if (finished) {
          return;
        }
        finished = true;
        if (abandoned) {
          for (const entry of snapshot) {
            checkpoints.delete(entry);
          }
        }
        if (pendingJoin === promise) {
          pendingJoin = undefined;
        }
        resolve();
      };
      const cancelTimer = clock.setTimeout(() => {
        finish(true);
      }, boundMs);
      void Promise.all(snapshot).then(() => {
        cancelTimer();
        finish(false);
      });
    });
    pendingJoin = promise;
    return promise;
  };

  return { renew, cancel, join };
}
