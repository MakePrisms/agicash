import type { RetryPolicy, TaskRunner } from '../engine';

type Lane = {
  /** Promise chain tail; the next enqueue waits on this then runs. */
  tail: Promise<unknown>;
  /** Queued-or-running tasks; the lane is removed when this reaches 0. */
  size: number;
};

/**
 * In-memory FIFO-per-lane task runner. Same lane => sequential; different lanes
 * => concurrent. Re-entrant: a running task may call `runTask` on its own lane;
 * the new task chains onto the lane tail and `runTask` returns immediately, so
 * the running task is never blocked on its own nested enqueue (no deadlock).
 * The CALLER must not `await` a nested same-lane enqueue (the processors
 * fire-and-forget via `void runner.runTask(...)`).
 *
 * Lane lifetime is tracked by `size`, which is incremented synchronously in
 * `runTask` before any await. A re-entrant enqueue therefore always observes a
 * live lane (the enclosing task is still in flight, so `size >= 1`), which is
 * what keeps a mid-drain GC from dropping the lane out from under it.
 */
export class KeyedQueue implements TaskRunner {
  private readonly lanes = new Map<string, Lane>();

  /** Test/observability hook: number of live lanes. */
  get laneCount(): number {
    return this.lanes.size;
  }

  runTask<T>(
    lane: string,
    fn: () => Promise<T>,
    policy?: RetryPolicy,
  ): Promise<T> {
    let entry = this.lanes.get(lane);
    if (!entry) {
      entry = { tail: Promise.resolve(), size: 0 };
      this.lanes.set(lane, entry);
    }
    entry.size += 1;

    const prevTail = entry.tail;
    const run = () => this.execute(fn, policy);
    // Continue the chain whether the previous task fulfilled or rejected.
    const result = prevTail.then(run, run);
    // Advance the tail to a settled marker so a rejection never breaks the chain,
    // and decrement/GC the lane once this task settles.
    entry.tail = result.then(
      () => this.onSettle(lane),
      () => this.onSettle(lane),
    );
    return result;
  }

  private onSettle(lane: string): void {
    const entry = this.lanes.get(lane);
    if (!entry) return;
    entry.size -= 1;
    if (entry.size <= 0) this.lanes.delete(lane);
  }

  private async execute<T>(
    fn: () => Promise<T>,
    policy?: RetryPolicy,
  ): Promise<T> {
    let failureCount = 0;
    for (;;) {
      try {
        return await fn();
      } catch (error) {
        if (!policy || !policy.shouldRetry(failureCount, error)) throw error;
        const delay = policy.retryDelay(failureCount);
        failureCount += 1;
        if (delay > 0) await new Promise<void>((r) => setTimeout(r, delay));
      }
    }
  }
}
