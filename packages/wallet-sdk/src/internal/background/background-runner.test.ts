import { describe, expect, it, mock } from 'bun:test';
import type { SdkEventMap } from '../../events';
import { SdkEventEmitter } from '../event-emitter';
import { BackgroundRunner } from './background-runner';

function setup(opts: { takeLead?: (n: number) => boolean } = {}) {
  let tick = 0;
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const states: string[] = [];
  emitter.on('background:state', (e) => states.push(e.state));
  const balanceCleanup = mock(() => undefined);
  const deps = {
    lockRepository: {
      takeLead: mock(async () =>
        opts.takeLead ? opts.takeLead(tick++) : true,
      ),
    },
    taskLoop: {
      runOnce: mock(async () => undefined),
      dispose: mock(() => undefined),
    },
    forwarder: {
      start: mock(async () => undefined),
      stop: mock(async () => undefined),
    },
    registerBalanceListeners: mock(async () => balanceCleanup),
    getUserId: mock(async () => 'user-1'),
    clientId: 'client-1',
    emitter,
    pollIntervalMs: 5000,
  };
  const runner = new BackgroundRunner(deps);
  return { runner, deps, states, balanceCleanup };
}

describe('BackgroundRunner', () => {
  it('start() goes stopped → starting → (after first tick as leader) leader, starting the forwarder + balance listeners', async () => {
    const { runner, deps, states } = setup({ takeLead: () => true });
    await runner.start();
    expect(deps.forwarder.start).toHaveBeenCalledWith('user-1');
    expect(deps.registerBalanceListeners).toHaveBeenCalledWith('user-1');
    expect(runner.state()).toBe('leader');
    expect(states).toContain('starting');
    expect(states).toContain('leader');
    expect(deps.taskLoop.runOnce).toHaveBeenCalledTimes(1); // immediate first tick
    await runner.stop(); // cleanup to prevent leaked interval
  });

  it('a tick that loses the lead → follower, disposes the spark thunks, does NOT run the loop', async () => {
    const { runner, deps } = setup({ takeLead: (n) => n === 0 }); // leader first tick, follower after
    await runner.start(); // tick 0 → leader (runOnce #1)
    await runner.runTick(); // tick 1 → follower
    expect(runner.state()).toBe('follower');
    expect(deps.taskLoop.dispose).toHaveBeenCalled();
    expect(deps.taskLoop.runOnce).toHaveBeenCalledTimes(1); // not called again as follower
    await runner.stop(); // cleanup
  });

  it('start() with no user stays starting and runs no tick body', async () => {
    const { deps } = setup();
    deps.getUserId = mock(async () => null) as never;
    const r = new BackgroundRunner({ ...deps });
    await r.start();
    expect(deps.forwarder.start).not.toHaveBeenCalled();
    expect(r.state()).toBe('starting');
    // No interval scheduled, no cleanup needed
  });

  it('a take_lead error is swallowed (stays follower, retries next tick)', async () => {
    const { deps } = setup();
    deps.lockRepository.takeLead = mock(async () => {
      throw new Error('rpc down');
    }) as never;
    const r = new BackgroundRunner({ ...deps });
    await r.start();
    await expect(r.runTick()).resolves.toBeUndefined();
    expect(r.state()).toBe('follower');
    await r.stop(); // cleanup
  });

  it('stop() goes → stopping → stopped, stops forwarder, disposes loop + balance listeners', async () => {
    const { runner, deps, balanceCleanup } = setup({ takeLead: () => true });
    await runner.start();
    await runner.stop();
    expect(deps.forwarder.stop).toHaveBeenCalledTimes(1);
    expect(deps.taskLoop.dispose).toHaveBeenCalled();
    expect(balanceCleanup).toHaveBeenCalledTimes(1);
    expect(runner.state()).toBe('stopped');
  });
});
