import { describe, expect, it } from 'bun:test';
import { ConcurrencyError } from '../../errors';
import { defaultRetryPolicy } from '../tasks/retry-policy';
import type { RetryPolicy } from '../tasks/task-runner';
import { createMutationRunner } from './mutation-runner';
import { createEngineQueryClient } from './query-client';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createMutationRunner', () => {
  it('runs same-lane tasks FIFO (sequential)', async () => {
    const runner = createMutationRunner(createEngineQueryClient());
    const order: number[] = [];
    const p1 = runner.runTask('L', async () => {
      await tick();
      order.push(1);
    });
    const p2 = runner.runTask('L', async () => {
      order.push(2);
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('does not overlap same-lane tasks (no concurrent execution)', async () => {
    const runner = createMutationRunner(createEngineQueryClient());
    let running = 0;
    let maxConcurrent = 0;
    const work = async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await tick();
      running -= 1;
    };
    await Promise.all([
      runner.runTask('L', work),
      runner.runTask('L', work),
      runner.runTask('L', work),
    ]);
    expect(maxConcurrent).toBe(1);
  });

  it('runs different lanes concurrently', async () => {
    const runner = createMutationRunner(createEngineQueryClient());
    let aRunning = false;
    let overlapped = false;
    const a = runner.runTask('A', async () => {
      aRunning = true;
      await tick();
      aRunning = false;
    });
    const b = runner.runTask('B', async () => {
      if (aRunning) overlapped = true;
    });
    await Promise.all([a, b]);
    expect(overlapped).toBe(true);
  });

  it('is re-entrant: a task may enqueue on its OWN lane without deadlock', async () => {
    const runner = createMutationRunner(createEngineQueryClient());
    const order: string[] = [];
    let nested: Promise<unknown> | undefined;
    await runner.runTask('L', async () => {
      order.push('outer-start');
      nested = runner.runTask('L', async () => {
        order.push('nested');
      });
      order.push('outer-end');
    });
    await nested;
    expect(order).toEqual(['outer-start', 'outer-end', 'nested']);
  });

  it('returns the task result and propagates rejection', async () => {
    const runner = createMutationRunner(createEngineQueryClient());
    await expect(runner.runTask('L', async () => 42)).resolves.toBe(42);
    await expect(
      runner.runTask('L', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('a failing task does not break the lane for the next task', async () => {
    const runner = createMutationRunner(createEngineQueryClient());
    const done: string[] = [];
    const p1 = runner
      .runTask('L', async () => {
        throw new Error('fail');
      })
      .catch(() => done.push('p1-rejected'));
    const p2 = runner.runTask('L', async () => {
      done.push('p2-ran');
    });
    await Promise.all([p1, p2]);
    expect(done).toEqual(['p1-rejected', 'p2-ran']);
  });

  it('runs once with no retry when no policy is given', async () => {
    const runner = createMutationRunner(createEngineQueryClient());
    let attempts = 0;
    await expect(
      runner.runTask('L', async () => {
        attempts += 1;
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    expect(attempts).toBe(1);
  });

  it('honors an explicit policy: shouldRetry sees 0,1,2 then gives up', async () => {
    const runner = createMutationRunner(createEngineQueryClient());
    const seen: number[] = [];
    const policy: RetryPolicy = {
      shouldRetry: (n) => {
        seen.push(n);
        return n < 2;
      },
      retryDelay: () => 0,
    };
    let attempts = 0;
    await expect(
      runner.runTask(
        'L',
        async () => {
          attempts += 1;
          throw new Error('boom');
        },
        policy,
      ),
    ).rejects.toThrow('boom');
    expect(attempts).toBe(3); // initial + 2 retries
    expect(seen).toEqual([0, 1, 2]);
  });

  it('honors the real defaultRetryPolicy (bounded-3): retries a transient ConcurrencyError then succeeds', async () => {
    const runner = createMutationRunner(createEngineQueryClient());
    let attempts = 0;
    const result = await runner.runTask(
      'L',
      async () => {
        attempts += 1;
        if (attempts < 3) throw new ConcurrencyError('retry me');
        return 'ok';
      },
      defaultRetryPolicy,
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  }, 10_000); // real exponentialBackoff sleeps 1s + 2s between attempts
});
