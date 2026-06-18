import { describe, expect, it } from 'bun:test';
import { KeyedQueue } from './keyed-queue';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('KeyedQueue', () => {
  it('runs same-lane tasks FIFO (sequential)', async () => {
    const q = new KeyedQueue();
    const order: number[] = [];
    const p1 = q.runTask('L', async () => {
      await tick();
      order.push(1);
    });
    const p2 = q.runTask('L', async () => {
      order.push(2);
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('does not overlap same-lane tasks (no concurrent execution)', async () => {
    const q = new KeyedQueue();
    let running = 0;
    let maxConcurrent = 0;
    const work = async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await tick();
      running -= 1;
    };
    await Promise.all([
      q.runTask('L', work),
      q.runTask('L', work),
      q.runTask('L', work),
    ]);
    expect(maxConcurrent).toBe(1);
  });

  it('runs different lanes concurrently', async () => {
    const q = new KeyedQueue();
    let aRunning = false;
    let overlapped = false;
    const a = q.runTask('A', async () => {
      aRunning = true;
      await tick();
      aRunning = false;
    });
    const b = q.runTask('B', async () => {
      if (aRunning) overlapped = true;
    });
    await Promise.all([a, b]);
    expect(overlapped).toBe(true);
  });

  it('is re-entrant: a task may enqueue on its OWN lane without deadlock', async () => {
    const q = new KeyedQueue();
    const order: string[] = [];
    let nested: Promise<unknown> | undefined;
    await q.runTask('L', async () => {
      order.push('outer-start');
      // fire-and-forget enqueue on the same lane (the contract: caller does NOT await it)
      nested = q.runTask('L', async () => {
        order.push('nested');
      });
      order.push('outer-end');
    });
    await nested; // resolves after the outer task settled — no deadlock
    expect(order).toEqual(['outer-start', 'outer-end', 'nested']);
  });

  it('re-entrant enqueue keeps the lane alive across the nested task (no mid-drain GC)', async () => {
    const q = new KeyedQueue();
    let nested: Promise<unknown> | undefined;
    let laneCountDuringNestedSchedule = -1;
    await q.runTask('L', async () => {
      nested = q.runTask('L', async () => {});
      // While the outer task is still running and a nested task is queued, the
      // lane must still exist (size === 2). A mid-drain GC would drop it.
      laneCountDuringNestedSchedule = q.laneCount;
    });
    await nested;
    await tick();
    expect(laneCountDuringNestedSchedule).toBe(1);
    expect(q.laneCount).toBe(0); // fully drained and GC'd afterwards
  });

  it('retries per policy: shouldRetry sees 0,1,2 then gives up', async () => {
    const q = new KeyedQueue();
    const seen: number[] = [];
    const policy = {
      shouldRetry: (n: number) => {
        seen.push(n);
        return n < 2;
      },
      retryDelay: () => 0,
    };
    let attempts = 0;
    await expect(
      q.runTask(
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

  it('retryDelay is called with the pre-increment failureCount', async () => {
    const q = new KeyedQueue();
    const delaySeen: number[] = [];
    const policy = {
      shouldRetry: (n: number) => n < 2,
      retryDelay: (n: number) => {
        delaySeen.push(n);
        return 0;
      },
    };
    await expect(
      q.runTask(
        'L',
        async () => {
          throw new Error('boom');
        },
        policy,
      ),
    ).rejects.toThrow('boom');
    expect(delaySeen).toEqual([0, 1]); // two retries scheduled, on counts 0 and 1
  });

  it('stops retrying as soon as shouldRetry returns false', async () => {
    const q = new KeyedQueue();
    let attempts = 0;
    const policy = {
      shouldRetry: () => false,
      retryDelay: () => 0,
    };
    await expect(
      q.runTask(
        'L',
        async () => {
          attempts += 1;
          throw new Error('nope');
        },
        policy,
      ),
    ).rejects.toThrow('nope');
    expect(attempts).toBe(1);
  });

  it('returns the resolved value and does not retry on success', async () => {
    const q = new KeyedQueue();
    let attempts = 0;
    const policy = {
      shouldRetry: () => true,
      retryDelay: () => 0,
    };
    const result = await q.runTask(
      'L',
      async () => {
        attempts += 1;
        return 42;
      },
      policy,
    );
    expect(result).toBe(42);
    expect(attempts).toBe(1);
  });

  it('runs once with no retry when no policy is given', async () => {
    const q = new KeyedQueue();
    let attempts = 0;
    await expect(
      q.runTask('L', async () => {
        attempts += 1;
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    expect(attempts).toBe(1);
  });

  it('garbage-collects a lane once it drains to idle', async () => {
    const q = new KeyedQueue();
    await q.runTask('L', async () => {});
    await tick();
    expect(q.laneCount).toBe(0);
  });

  it('a failing task does not break the lane for the next task', async () => {
    const q = new KeyedQueue();
    const done: string[] = [];
    const p1 = q
      .runTask('L', async () => {
        throw new Error('fail');
      })
      .catch(() => done.push('p1-rejected'));
    const p2 = q.runTask('L', async () => {
      done.push('p2-ran');
    });
    await Promise.all([p1, p2]);
    expect(done).toEqual(['p1-rejected', 'p2-ran']);
  });

  it('GCs a lane then recreates it cleanly for a later task', async () => {
    const q = new KeyedQueue();
    await q.runTask('L', async () => {});
    await tick();
    expect(q.laneCount).toBe(0);
    const order: number[] = [];
    await q.runTask('L', async () => {
      order.push(1);
    });
    await tick();
    expect(order).toEqual([1]);
    expect(q.laneCount).toBe(0);
  });
});
