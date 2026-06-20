import { describe, expect, it, mock } from 'bun:test';
import { SessionExpiryScheduler } from './session-expiry-scheduler';

const b64 = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (exp: number) => `${b64({ alg: 'none' })}.${b64({ exp })}.sig`;

// a controllable fake timer
const makeFakeTimers = () => {
  let scheduled: { fn: () => void; delay: number } | null = null;
  return {
    setTimer: (fn: () => void, delay: number) => {
      scheduled = { fn, delay };
      return scheduled as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      scheduled = null;
    },
    fireNow: () => scheduled?.fn(),
    get scheduledDelay() {
      return scheduled?.delay ?? null;
    },
  };
};

const storageWith = (refreshExpSec: number | null) => ({
  persistent: {
    getItem: async (k: string) =>
      k === 'refresh_token' && refreshExpSec !== null
        ? jwt(refreshExpSec)
        : null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
  session: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
});

describe('SessionExpiryScheduler', () => {
  it('arms a timer for (exp - margin) and calls onExpiry when it fires', async () => {
    const timers = makeFakeTimers();
    const onExpiry = mock(() => undefined);
    const nowMs = 1_000_000;
    const expSec = Math.floor(nowMs / 1000) + 100; // 100s out
    const sched = new SessionExpiryScheduler({
      storage: storageWith(expSec),
      onExpiry,
      now: () => nowMs,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      marginMs: 5000,
    });
    await sched.armIfLoggedIn();
    // delay = (expSec*1000 - 5000) - nowMs  == 95000
    expect(timers.scheduledDelay).toBe(95_000);
    timers.fireNow();
    expect(onExpiry).toHaveBeenCalledTimes(1);
  });

  it('does not arm when there is no refresh token', async () => {
    const timers = makeFakeTimers();
    const sched = new SessionExpiryScheduler({
      storage: storageWith(null),
      onExpiry: () => undefined,
      now: () => 1_000_000,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    await sched.armIfLoggedIn();
    expect(timers.scheduledDelay).toBeNull();
  });

  it('chains timers for delays beyond the 2^31-1 ms ceiling', async () => {
    const timers = makeFakeTimers();
    const onExpiry = mock(() => undefined);
    const nowMs = 0;
    const expSec = 40 * 24 * 60 * 60; // 40 days out, > 24.8d ceiling
    const sched = new SessionExpiryScheduler({
      storage: storageWith(expSec),
      onExpiry,
      now: () => nowMs,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      marginMs: 0,
    });
    await sched.armIfLoggedIn();
    // first hop is clamped to the max safe delay, NOT the full 40d, and does NOT fire onExpiry yet
    expect(timers.scheduledDelay).toBe(2_147_483_647);
    timers.fireNow();
    expect(onExpiry).toHaveBeenCalledTimes(0); // still waiting (chained)
  });

  it('disarm() clears the pending timer', async () => {
    const timers = makeFakeTimers();
    const onExpiry = mock(() => undefined);
    const expSec = Math.floor(Date.now() / 1000) + 100;
    const sched = new SessionExpiryScheduler({
      storage: storageWith(expSec),
      onExpiry,
      now: () => Date.now(),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    await sched.armIfLoggedIn();
    sched.disarm();
    expect(timers.scheduledDelay).toBeNull();
  });
});
