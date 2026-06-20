import { describe, expect, mock, test } from 'bun:test';
import { defaultRetryDelayMs, retryWithBackoff } from './retry';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await flush();
  }
};

describe('retryWithBackoff', () => {
  test('returns the value on first success without retrying', async () => {
    const fn = mock(async () => 'ok');

    const result = await retryWithBackoff(fn, { retries: 5 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on failure and resolves once it succeeds', async () => {
    let calls = 0;
    const fn = mock(async () => {
      calls++;
      if (calls < 3) {
        throw new Error('flaky');
      }
      return 'ok';
    });

    const result = await retryWithBackoff(fn, { retries: 5, delayMs: () => 0 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('throws the last error after exhausting the retry budget', async () => {
    const fn = mock(async () => {
      throw new Error('always');
    });
    const onError = mock(() => undefined);

    await expect(
      retryWithBackoff(fn, { retries: 2, delayMs: () => 0, onError }),
    ).rejects.toThrow('always');
    // initial attempt + 2 retries
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(3);
  });

  test('stops retrying once the signal aborts', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fn = mock(async () => {
      calls++;
      // Abort from within the first attempt: the next iteration must not run fn.
      if (calls === 1) {
        controller.abort();
      }
      throw new Error('flaky');
    });

    await expect(
      retryWithBackoff(fn, {
        retries: 5,
        signal: controller.signal,
        delayMs: () => 0,
      }),
    ).rejects.toBeDefined();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('interrupts a pending backoff delay on abort (does not wait it out)', async () => {
    const controller = new AbortController();
    const fn = mock(async () => {
      throw new Error('flaky');
    });

    // A 100s backoff: the test only completes promptly if abort interrupts it.
    const promise = retryWithBackoff(fn, {
      retries: 5,
      signal: controller.signal,
      delayMs: () => 100_000,
    });

    await flush();
    expect(fn).toHaveBeenCalledTimes(1);

    controller.abort();
    await expect(promise).rejects.toBeDefined();
    await settle();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('does not call fn at all when the signal is already aborted', async () => {
    const fn = mock(async () => 'ok');

    await expect(
      retryWithBackoff(fn, { retries: 5, signal: AbortSignal.abort() }),
    ).rejects.toBeDefined();

    expect(fn).not.toHaveBeenCalled();
  });

  test('defaultRetryDelayMs grows exponentially and caps at 30s', () => {
    expect(defaultRetryDelayMs(0)).toBe(1000);
    expect(defaultRetryDelayMs(1)).toBe(2000);
    expect(defaultRetryDelayMs(4)).toBe(16_000);
    expect(defaultRetryDelayMs(10)).toBe(30_000);
  });
});
