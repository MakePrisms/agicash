import type { RealtimeClient } from '@supabase/supabase-js';
import {
  type ChannelStatus,
  SupabaseRealtimeManager,
} from './supabase-realtime-manager';

export type DatabaseChangeHandler = {
  event: string;
  // biome-ignore lint/suspicious/noExplicitAny: we are not sure what the payload is here. Each table handler defines the payload type.
  handleEvent: (payload: any) => void | Promise<void>;
};

export type RealtimeApi = {
  /** Current status of the wallet channel. */
  getStatus: () => ChannelStatus;
  /** The wallet channel's last error, if any. */
  getError: () => Error | undefined;
  /**
   * Subscribes to wallet channel status changes; returns the unsubscribe
   * function.
   */
  onStatusChange: (listener: () => void) => () => void;
  /** Host binding for the app's online signal (resubscribes when back online). */
  setOnlineStatus: (isOnline: boolean) => void;
  /** Host binding for the app's active/foreground signal. */
  setActiveStatus: (isActive: boolean) => void;
  /**
   * The raw realtime manager, for devtools inspection only (e.g. a host can
   * expose it on `window` for debugging). NOT a supported API: it is unstable
   * and may be removed. The `__` prefix marks it as a debug accessor, not part
   * of the curated surface.
   */
  __debugManager: SupabaseRealtimeManager;
};

export type RealtimeApiDeps = {
  realtimeClient: RealtimeClient;
  /**
   * Resolves the current user's id from the SDK's user state.
   * @throws if no user is loaded yet.
   */
  getCurrentUserId: () => string;
  /** Every domain's database change handlers, dispatched by event name. */
  changeHandlers: DatabaseChangeHandler[];
  /**
   * Called when the channel is initially connected or reconnected. Used to
   * refetch the domain state to catch up on updates missed while the
   * realtime connection was down.
   */
  onConnected: () => void;
  /**
   * Observes the current wallet user id (null when logged out), invoking the
   * listener on every change. The SDK root wires this from the auth state;
   * `start()` uses it to (re)subscribe the channel as the session changes.
   */
  subscribeToUserId: (listener: (userId: string | null) => void) => () => void;
};

/**
 * Creates the realtime engine. `start` is returned alongside the public `api`,
 * not on it: the SDK root wires `start` into `sdk.start()` so the subscription
 * is driven through that single entry point and a host can't double-subscribe
 * by calling it directly. `api` is what `sdk.realtime` exposes.
 */
export function createRealtimeApi(deps: RealtimeApiDeps): {
  api: RealtimeApi;
  /**
   * Starts auto-managing the wallet broadcast channel for the SDK's lifetime:
   * subscribes the current user's `wallet:{userId}` channel and re-subscribes
   * as the session changes (login / logout / user switch), dispatching DB
   * change events to the SDK's domain state and refetching on (re)connect.
   * Returns a stop function. Client-only; call once per host (app mount /
   * daemon boot).
   */
  start: () => () => void;
} {
  const {
    realtimeClient,
    getCurrentUserId,
    changeHandlers,
    onConnected,
    subscribeToUserId,
  } = deps;

  const manager = new SupabaseRealtimeManager(realtimeClient);

  // RealtimeClient adds the "realtime:" prefix to the topic name; the manager
  // keys its state by the prefixed form.
  const topicFor = (userId: string) => `realtime:wallet:${userId}`;

  const buildChannelFor = (userId: string) =>
    manager
      .channel(`wallet:${userId}`, { private: true })
      .on('broadcast', { event: '*' }, ({ event, payload }) => {
        const handler = changeHandlers.find(
          (handler) => handler.event === event,
        );
        handler?.handleEvent(payload);
      });

  // Status reads target the current user's channel (the one start() manages).
  const currentTopic = () => topicFor(getCurrentUserId());

  const start = () => {
    let subscribedUserId: string | null = null;

    const subscribeFor = (userId: string) => {
      const channel = manager.addChannel(buildChannelFor(userId));
      channel.subscribe(onConnected).catch((error) => {
        console.error('Error subscribing to realtime channel', {
          cause: error,
        });
      });
    };

    const unsubscribeFor = (userId: string) => {
      manager
        .removeChannel(topicFor(userId), { onConnected })
        .catch((error) => {
          console.error('Error unsubscribing from realtime channel', {
            cause: error,
          });
        });
    };

    // Subscribe the current user's channel; re-subscribe when the user
    // changes (login / logout / switch), tearing down the previous one.
    const reconcile = (userId: string | null) => {
      if (userId === subscribedUserId) {
        return;
      }
      if (subscribedUserId) {
        unsubscribeFor(subscribedUserId);
      }
      subscribedUserId = userId;
      if (userId) {
        subscribeFor(userId);
      }
    };

    const stopObserving = subscribeToUserId(reconcile);

    return () => {
      stopObserving();
      if (subscribedUserId) {
        unsubscribeFor(subscribedUserId);
        subscribedUserId = null;
      }
    };
  };

  return {
    api: {
      getStatus: () => manager.getChannelStatus(currentTopic()) ?? 'idle',
      getError: () => manager.getChannelError(currentTopic()),
      onStatusChange: (listener) =>
        manager.subscribeToChannelStatusChange(currentTopic(), listener),
      setOnlineStatus: (isOnline) => manager.setOnlineStatus(isOnline),
      setActiveStatus: (isActive) => manager.setActiveStatus(isActive),
      __debugManager: manager,
    },
    start,
  };
}
