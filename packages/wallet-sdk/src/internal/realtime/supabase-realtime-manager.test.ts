import { beforeEach, describe, expect, it } from 'bun:test';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { SupabaseRealtimeManager } from './supabase-realtime-manager';

// ---------------------------------------------------------------------------
// Fake RealtimeClient infrastructure
// ---------------------------------------------------------------------------

type SubscribeCallback = (
  status: REALTIME_SUBSCRIBE_STATES,
  err?: Error,
) => void;

/** Minimal fake channel: records the subscribe callback so tests can fire it. */
function makeFakeChannel(topic: string) {
  let subscribeCallback: SubscribeCallback | null = null;
  const fakeSocket = { connectionState: () => 'open' };

  const channel = {
    topic,
    socket: fakeSocket,
    subscribe(cb: SubscribeCallback) {
      subscribeCallback = cb;
      return channel;
    },
    /** Drive a status change from the test (fires the registered callback). */
    fireStatus(status: REALTIME_SUBSCRIBE_STATES, err?: Error) {
      subscribeCallback?.(status, err);
    },
    on(_type: string, _filter: unknown, _cb: unknown) {
      return channel;
    },
  };
  return channel;
}

type FakeChannel = ReturnType<typeof makeFakeChannel>;

function makeFakeRealtimeClient() {
  const channels = new Map<string, FakeChannel>();
  let removeCount = 0;

  const client = {
    conn: null as null | { readyState: number },
    channel(topic: string) {
      const ch = makeFakeChannel(`realtime:${topic}`);
      channels.set(ch.topic, ch);
      return ch;
    },
    async removeChannel(_ch: unknown) {
      removeCount++;
      return 'ok' as const;
    },
    async setAuth() {
      /* no-op */
    },
    // Test-only accessors
    getChannel(topic: string) {
      return channels.get(topic);
    },
    get removeCount() {
      return removeCount;
    },
  };
  return client;
}

type FakeClient = ReturnType<typeof makeFakeRealtimeClient>;

// ---------------------------------------------------------------------------
// Helper: flush all pending microtasks + one macrotask tick (setTimeout 0).
// Required because subscribeToChannel has multiple await hops before it calls
// channel.subscribe(cb) on the fake channel.
// ---------------------------------------------------------------------------
function flushAsync() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SupabaseRealtimeManager', () => {
  let client: FakeClient;

  beforeEach(() => {
    client = makeFakeRealtimeClient();
  });

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe('construction', () => {
    it('exposes the passed realtimeClient', () => {
      const manager = new SupabaseRealtimeManager(client as never);
      expect(manager.realtimeClient as unknown).toBe(client);
    });

    it('starts with no channels tracked', () => {
      const manager = new SupabaseRealtimeManager(client as never);
      expect(manager.getChannelStatus('realtime:x')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // addChannel + getChannelStatus
  // -------------------------------------------------------------------------

  describe('addChannel', () => {
    it('adds a channel in idle status', () => {
      const manager = new SupabaseRealtimeManager(client as never);
      const builder = manager.channel('my-topic');
      manager.addChannel(builder);
      expect(manager.getChannelStatus('realtime:my-topic')).toBe('idle');
    });

    it('returns the existing topic when called twice with the same builder', () => {
      const manager = new SupabaseRealtimeManager(client as never);
      const builder = manager.channel('dup-topic');
      manager.addChannel(builder);
      const second = manager.addChannel(builder);
      expect(second.topic).toBe('realtime:dup-topic');
    });
  });

  // -------------------------------------------------------------------------
  // subscribe: status transitions
  // -------------------------------------------------------------------------

  describe('subscribe', () => {
    it('transitions to subscribing (sync) then subscribed after SUBSCRIBED callback', async () => {
      const manager = new SupabaseRealtimeManager(client as never);
      const builder = manager.channel('test-topic');
      const ch = manager.addChannel(builder);
      const p = ch.subscribe();

      // 'subscribing' is set synchronously before any await in subscribeToChannel
      expect(manager.getChannelStatus('realtime:test-topic')).toBe(
        'subscribing',
      );

      // Flush so the fake channel has its subscribe callback registered
      await flushAsync();

      const fakeChannel = client.getChannel('realtime:test-topic');
      fakeChannel?.fireStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
      await p;

      expect(manager.getChannelStatus('realtime:test-topic')).toBe(
        'subscribed',
      );
    });

    it('calls onConnected callback when SUBSCRIBED fires', async () => {
      const manager = new SupabaseRealtimeManager(client as never);
      const builder = manager.channel('cb-topic');
      const ch = manager.addChannel(builder);

      let callCount = 0;
      const onConnected = () => {
        callCount++;
      };
      const p = ch.subscribe(onConnected);
      await flushAsync();

      client
        .getChannel('realtime:cb-topic')
        ?.fireStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
      await p;

      expect(callCount).toBe(1);
    });

    it('throws if subscribing to a topic not yet added', async () => {
      const manager = new SupabaseRealtimeManager(client as never);
      await expect(
        manager.subscribe('realtime:does-not-exist'),
      ).rejects.toThrow('Channel realtime:does-not-exist not found');
    });
  });

  // -------------------------------------------------------------------------
  // Reference counting: removeChannel
  // -------------------------------------------------------------------------

  describe('removeChannel reference counting', () => {
    it('does NOT remove from client when a second subscriber still holds the channel', async () => {
      const manager = new SupabaseRealtimeManager(client as never);
      const builder = manager.channel('shared-topic');
      const ch1 = manager.addChannel(builder);
      const ch2 = manager.addChannel(builder);

      const p1 = ch1.subscribe();
      // Second subscribe: same topic, channel already subscribing — it increments
      // subscribersCount but subscribeToChannel is a no-op for subscribing status
      const p2 = ch2.subscribe();
      await flushAsync();

      // Fire subscribed to let both promises resolve
      client
        .getChannel('realtime:shared-topic')
        ?.fireStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
      await p1;
      await p2;

      const removeBefore = client.removeCount;

      // First unsubscribe — count 2→1, must NOT call removeChannel on client
      await ch1.unsubscribe();
      expect(client.removeCount).toBe(removeBefore);
      expect(manager.getChannelStatus('realtime:shared-topic')).toBe(
        'subscribed',
      );
    });

    it('removes from client when last subscriber unsubscribes (count reaches 0)', async () => {
      const manager = new SupabaseRealtimeManager(client as never);
      const builder = manager.channel('shared-topic');
      const ch1 = manager.addChannel(builder);
      const ch2 = manager.addChannel(builder);

      const p1 = ch1.subscribe();
      const p2 = ch2.subscribe();
      await flushAsync();

      client
        .getChannel('realtime:shared-topic')
        ?.fireStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
      await p1;
      await p2;

      const removeBefore = client.removeCount;

      await ch1.unsubscribe();
      await ch2.unsubscribe();

      // Exactly one client removeChannel call when count hits 0
      expect(client.removeCount).toBe(removeBefore + 1);
      // Channel no longer tracked
      expect(manager.getChannelStatus('realtime:shared-topic')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Error / timeout → resubscribe enqueue
  //
  // Strategy: fire the error, assert status is 'reconnecting', then immediately
  // remove the channel so processResubscribeQueue finds it gone and exits,
  // preventing an infinite hang waiting for a callback that will never fire.
  // -------------------------------------------------------------------------

  describe('channel error enqueues resubscribe', () => {
    it('transitions to reconnecting when CHANNEL_ERROR fires while online+active', async () => {
      const manager = new SupabaseRealtimeManager(client as never);
      const builder = manager.channel('err-topic');
      const ch = manager.addChannel(builder);
      const p = ch.subscribe();
      await flushAsync();

      client
        .getChannel('realtime:err-topic')
        ?.fireStatus(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR);
      await p;

      // resubscribe() sets status to 'reconnecting' synchronously before any await
      expect(manager.getChannelStatus('realtime:err-topic')).toBe(
        'reconnecting',
      );

      // Remove channel so the background resubscribe loop exits cleanly
      await manager.removeChannel('realtime:err-topic');
    });

    it('transitions to reconnecting when TIMED_OUT fires while online+active', async () => {
      const manager = new SupabaseRealtimeManager(client as never);
      const builder = manager.channel('timeout-topic');
      const ch = manager.addChannel(builder);
      const p = ch.subscribe();
      await flushAsync();

      client
        .getChannel('realtime:timeout-topic')
        ?.fireStatus(REALTIME_SUBSCRIBE_STATES.TIMED_OUT);
      await p;

      expect(manager.getChannelStatus('realtime:timeout-topic')).toBe(
        'reconnecting',
      );

      await manager.removeChannel('realtime:timeout-topic');
    });

    it('closes (not resubscribes) when error fires while offline', async () => {
      const manager = new SupabaseRealtimeManager(client as never);
      manager.setOnlineStatus(false);

      const builder = manager.channel('offline-err-topic');
      const ch = manager.addChannel(builder);
      const p = ch.subscribe();
      await flushAsync();

      const removeBefore = client.removeCount;

      client
        .getChannel('realtime:offline-err-topic')
        ?.fireStatus(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR);
      await p;

      // closeChannel is async — flush so it completes
      await flushAsync();

      // realtimeClient.removeChannel was called (channel was closed)
      expect(client.removeCount).toBeGreaterThan(removeBefore);
      // Status is 'closed', not 'reconnecting'
      expect(manager.getChannelStatus('realtime:offline-err-topic')).toBe(
        'closed',
      );
    });
  });

  // -------------------------------------------------------------------------
  // setOnlineStatus / setActiveStatus → resubscribe inactive channels
  // -------------------------------------------------------------------------

  describe('setOnlineStatus / setActiveStatus', () => {
    it('going online+active triggers resubscribe for closed channels', async () => {
      const manager = new SupabaseRealtimeManager(client as never);
      manager.setOnlineStatus(false);

      const builder = manager.channel('closed-topic');
      const ch = manager.addChannel(builder);
      const p = ch.subscribe();
      await flushAsync();

      client
        .getChannel('realtime:closed-topic')
        ?.fireStatus(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR);
      await p;
      await flushAsync(); // let closeChannel complete

      expect(manager.getChannelStatus('realtime:closed-topic')).toBe('closed');

      // Coming back online triggers resubscribe → status becomes 'reconnecting'
      manager.setOnlineStatus(true);
      expect(manager.getChannelStatus('realtime:closed-topic')).toBe(
        'reconnecting',
      );

      await manager.removeChannel('realtime:closed-topic');
    });

    it('going active triggers resubscribe for closed channels', async () => {
      const manager = new SupabaseRealtimeManager(client as never);
      manager.setActiveStatus(false);

      const builder = manager.channel('inactive-topic');
      const ch = manager.addChannel(builder);
      const p = ch.subscribe();
      await flushAsync();

      client
        .getChannel('realtime:inactive-topic')
        ?.fireStatus(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR);
      await p;
      await flushAsync();

      expect(manager.getChannelStatus('realtime:inactive-topic')).toBe(
        'closed',
      );

      manager.setActiveStatus(true);
      expect(manager.getChannelStatus('realtime:inactive-topic')).toBe(
        'reconnecting',
      );

      await manager.removeChannel('realtime:inactive-topic');
    });
  });

  // -------------------------------------------------------------------------
  // subscribeToChannelStatusChange
  // -------------------------------------------------------------------------

  describe('subscribeToChannelStatusChange', () => {
    it('notifies listener on status change', async () => {
      const manager = new SupabaseRealtimeManager(client as never);
      const builder = manager.channel('notify-topic');
      const ch = manager.addChannel(builder);

      const statusHistory: string[] = [];
      // Register BEFORE subscribe — 'subscribing' fires synchronously in subscribeToChannel
      manager.subscribeToChannelStatusChange('realtime:notify-topic', () => {
        const s = manager.getChannelStatus('realtime:notify-topic');
        if (s) statusHistory.push(s);
      });

      const p = ch.subscribe();
      // 'subscribing' fires synchronously — no flush needed for this assertion
      expect(statusHistory).toContain('subscribing');

      await flushAsync();
      client
        .getChannel('realtime:notify-topic')
        ?.fireStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
      await p;

      expect(statusHistory).toContain('subscribed');
    });

    it('stops notifying after unsubscribe', async () => {
      const manager = new SupabaseRealtimeManager(client as never);
      const builder = manager.channel('unsub-notify-topic');
      const ch = manager.addChannel(builder);

      const statusHistory: string[] = [];
      const unsub = manager.subscribeToChannelStatusChange(
        'realtime:unsub-notify-topic',
        () => {
          const s = manager.getChannelStatus('realtime:unsub-notify-topic');
          if (s) statusHistory.push(s);
        },
      );

      const p = ch.subscribe();
      expect(statusHistory).toContain('subscribing');

      // Unsubscribe before SUBSCRIBED fires
      unsub();

      await flushAsync();
      client
        .getChannel('realtime:unsub-notify-topic')
        ?.fireStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
      await p;

      // 'subscribed' must NOT appear — listener was removed before it fired
      expect(statusHistory).not.toContain('subscribed');
    });
  });
});
