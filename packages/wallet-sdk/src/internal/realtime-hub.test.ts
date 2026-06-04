/**
 * Realtime broadcast hub tests — Slice 5 / PR7.
 *
 * Fakes the supabase-js client's chainable channel builder, capturing the broadcast handler + the
 * subscribe-status callback. Asserts: it subscribes the `wallet:${userId}` PRIVATE channel; a
 * broadcast message is forwarded to `dispatch(event, payload)`; the SUBSCRIBED status fires
 * `onConnected` (the reconcile); `subscribe` is idempotent; and `stop()` removes the channel.
 */
import { describe, expect, mock, test } from 'bun:test';
import { RealtimeHub } from './realtime-hub';
import type { WalletSupabaseClient } from './supabase-client';

/** A fake supabase client whose channel records the broadcast handler + subscribe callback. */
function fakeSupabase() {
  let broadcastHandler:
    | ((message: { event: string; payload?: unknown }) => void)
    | undefined;
  let subscribeCallback: ((status: string) => void) | undefined;
  let channelName: string | undefined;
  let channelConfig: unknown;
  const removed: unknown[] = [];

  const channel = {
    on: mock(
      (
        _type: string,
        _filter: unknown,
        handler: (message: { event: string; payload?: unknown }) => void,
      ) => {
        broadcastHandler = handler;
        return channel;
      },
    ),
    subscribe: mock((cb: (status: string) => void) => {
      subscribeCallback = cb;
      return channel;
    }),
  };

  const supabase = {
    channel: mock((name: string, config?: unknown) => {
      channelName = name;
      channelConfig = config;
      return channel;
    }),
    removeChannel: mock(async (ch: unknown) => {
      removed.push(ch);
    }),
  } as unknown as WalletSupabaseClient;

  return {
    supabase,
    fireBroadcast: (event: string, payload?: unknown) =>
      broadcastHandler?.({ event, payload }),
    fireStatus: (status: string) => subscribeCallback?.(status),
    channelName: () => channelName,
    channelConfig: () => channelConfig,
    removedCount: () => removed.length,
  };
}

describe('RealtimeHub', () => {
  test('subscribes the wallet:${userId} PRIVATE broadcast channel', () => {
    const sb = fakeSupabase();
    const hub = new RealtimeHub({
      supabase: sb.supabase,
      dispatch: () => undefined,
      onConnected: () => undefined,
    });

    hub.subscribe('user-1');

    expect(sb.channelName()).toBe('wallet:user-1');
    expect(sb.channelConfig()).toEqual({ config: { private: true } });
    expect(hub.isSubscribed()).toBe(true);
  });

  test('forwards a broadcast message to dispatch(event, payload)', () => {
    const sb = fakeSupabase();
    const dispatched: { event: string; payload: unknown }[] = [];
    const hub = new RealtimeHub({
      supabase: sb.supabase,
      dispatch: (event, payload) => dispatched.push({ event, payload }),
      onConnected: () => undefined,
    });

    hub.subscribe('user-1');
    sb.fireBroadcast('ACCOUNT_UPDATED', { id: 'acc1' });

    expect(dispatched).toEqual([
      { event: 'ACCOUNT_UPDATED', payload: { id: 'acc1' } },
    ]);
  });

  test('SUBSCRIBED status fires onConnected (the reconcile)', () => {
    const sb = fakeSupabase();
    let connected = 0;
    const hub = new RealtimeHub({
      supabase: sb.supabase,
      dispatch: () => undefined,
      onConnected: () => connected++,
    });

    hub.subscribe('user-1');
    sb.fireStatus('SUBSCRIBED');
    // A non-SUBSCRIBED status does not reconcile.
    sb.fireStatus('CHANNEL_ERROR');

    expect(connected).toBe(1);
  });

  test('subscribe is idempotent (a second call opens no new channel)', () => {
    const sb = fakeSupabase();
    const channelSpy = sb.supabase.channel as ReturnType<typeof mock>;
    const hub = new RealtimeHub({
      supabase: sb.supabase,
      dispatch: () => undefined,
      onConnected: () => undefined,
    });

    hub.subscribe('user-1');
    hub.subscribe('user-1');

    expect(channelSpy.mock.calls).toHaveLength(1);
  });

  test('stop() removes the channel and clears the held reference', async () => {
    const sb = fakeSupabase();
    const hub = new RealtimeHub({
      supabase: sb.supabase,
      dispatch: () => undefined,
      onConnected: () => undefined,
    });

    hub.subscribe('user-1');
    await hub.stop();

    expect(sb.removedCount()).toBe(1);
    expect(hub.isSubscribed()).toBe(false);
  });

  test('stop() while not subscribed is a no-op', async () => {
    const sb = fakeSupabase();
    const hub = new RealtimeHub({
      supabase: sb.supabase,
      dispatch: () => undefined,
      onConnected: () => undefined,
    });

    await hub.stop();

    expect(sb.removedCount()).toBe(0);
  });
});
