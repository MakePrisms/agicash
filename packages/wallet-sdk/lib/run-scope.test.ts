import { describe, expect, it } from 'bun:test';
import { type ScopeClock, createRunScopes } from './run-scope';

function createManualClock(): {
  clock: ScopeClock;
  timers: Array<{ callback: () => void; cancelled: boolean }>;
} {
  const timers: Array<{ callback: () => void; cancelled: boolean }> = [];
  const arm = (callback: () => void) => {
    const timer = { callback, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  return { clock: { setInterval: arm, setTimeout: arm }, timers };
}

describe('createRunScopes', () => {
  it('forgets a delay that fired normally', async () => {
    const { clock, timers } = createManualClock();
    const scopes = createRunScopes(clock);
    const scope = scopes.renew();
    const slept = scope.delay(1000);
    timers[0]?.callback();
    await slept;
    scopes.cancel();
    expect(timers[0]?.cancelled).toBe(false);
  });

  it('releases a pending delay early on cancel', async () => {
    const { clock, timers } = createManualClock();
    const scopes = createRunScopes(clock);
    const scope = scopes.renew();
    const slept = scope.delay(1000);
    scopes.cancel();
    await slept;
    expect(scope.alive).toBe(false);
    expect(timers[0]?.cancelled).toBe(true);
  });
});
