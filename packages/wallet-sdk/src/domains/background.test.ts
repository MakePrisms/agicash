import { describe, expect, test } from 'bun:test';
import type { SdkCoreEventMap } from '../events';
import { EventBus } from '../internal/event-bus';
import { BackgroundDomain, type IntervalScheduler } from './background';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function harness(initialLead: boolean) {
  let lead = initialLead;
  let tick: (() => void) | null = null;
  const calls: string[] = [];
  const states: string[] = [];

  const scheduler: IntervalScheduler = {
    setInterval: (fn) => {
      tick = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: () => {
      tick = null;
    },
  };
  const events = new EventBus<SdkCoreEventMap>();
  events.on('background:state', ({ state }) => states.push(state));

  const bg = new BackgroundDomain({
    lockRepo: { takeLead: async () => lead } as never,
    changeFeed: {
      start: async () => {
        calls.push('feed.start');
      },
      stop: async () => {
        calls.push('feed.stop');
      },
      resync: () => {
        calls.push('feed.resync');
      },
    } as never,
    registry: {
      activate: () => {
        calls.push('activate');
      },
      deactivate: () => {
        calls.push('deactivate');
      },
    } as never,
    manager: { setOnlineStatus: () => {}, setActiveStatus: () => {} } as never,
    events,
    getUserId: async () => 'user-1',
    clientId: 'client-1',
    scheduler,
  });

  return {
    bg,
    states,
    calls,
    setLead: (v: boolean) => {
      lead = v;
    },
    tick: async () => {
      tick?.();
      await settle();
    },
  };
}

describe('BackgroundDomain', () => {
  test('start → follower; ChangeFeed starts but processors stay off until leader', async () => {
    const h = harness(false);
    await h.bg.start();
    expect(h.bg.state).toBe('follower');
    expect(h.calls).toEqual(['feed.start']);
    expect(h.states).toEqual(['starting', 'follower']);
  });

  test('becomes leader on a winning poll, activates processors', async () => {
    const h = harness(false);
    await h.bg.start();
    h.setLead(true);
    await h.tick();
    expect(h.bg.state).toBe('leader');
    expect(h.calls).toContain('activate');
  });

  test('start while inactive parks at follower; promotes only when active', async () => {
    const h = harness(true); // would win the lease if it polled
    h.bg.setActiveStatus(false); // backgrounded before start
    await h.bg.start();
    expect(h.bg.state).toBe('follower'); // must NOT become a non-renewing leader
    expect(h.calls).not.toContain('activate');

    h.bg.setActiveStatus(true); // host reports tab active → promote + schedule renewal
    await settle();
    expect(h.bg.state).toBe('leader');
    expect(h.calls).toContain('activate');
  });

  test('demotes to follower + deactivates when the lease is lost', async () => {
    const h = harness(true);
    await h.bg.start();
    expect(h.bg.state).toBe('leader');
    h.setLead(false);
    await h.tick();
    expect(h.bg.state).toBe('follower');
    expect(h.calls).toContain('deactivate');
  });

  test('stop → stopping → stopped; deactivates + stops the feed', async () => {
    const h = harness(true);
    await h.bg.start();
    await h.bg.stop();
    expect(h.bg.state).toBe('stopped');
    expect(h.calls).toContain('deactivate');
    expect(h.calls).toContain('feed.stop');
    expect(h.states.slice(-2)).toEqual(['stopping', 'stopped']);
  });

  test('start throws when not signed in', async () => {
    const h = harness(false);
    (
      h.bg as unknown as { deps: { getUserId: () => Promise<string | null> } }
    ).deps.getUserId = async () => null;
    await expect(h.bg.start()).rejects.toThrow();
    expect(h.bg.state).toBe('stopped');
  });
});
