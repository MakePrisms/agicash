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
  /**
   * Subscribes the current user's wallet broadcast channel and dispatches
   * database change events to the SDK's domain state. Ref-counted — matching
   * subscribe/unsubscribe pairs share one channel.
   * @throws if no user is loaded yet.
   */
  subscribe: () => Promise<void>;
  /** Releases one subscription to the wallet channel. */
  unsubscribe: () => Promise<void>;
  /** Current status of the wallet channel. */
  getStatus: () => ChannelStatus;
  /** The wallet channel's last error, if any. */
  getError: () => Error | undefined;
  /**
   * Subscribes to wallet channel status changes (useSyncExternalStore
   * compatible). Returns the unsubscribe function.
   */
  onStatusChange: (listener: () => void) => () => void;
  /** Host binding for the app's online signal (resubscribes when back online). */
  setOnlineStatus: (isOnline: boolean) => void;
  /** Host binding for the app's active/foreground signal. */
  setActiveStatus: (isActive: boolean) => void;
  /**
   * Transitional escape hatch — NOT part of the public surface. The raw
   * manager is exposed only for the web's window debug handle.
   */
  internal: {
    manager: SupabaseRealtimeManager;
  };
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
};

export function createRealtimeApi(deps: RealtimeApiDeps): RealtimeApi {
  const { realtimeClient, getCurrentUserId, changeHandlers, onConnected } =
    deps;

  const manager = new SupabaseRealtimeManager(realtimeClient);

  const getTopic = () =>
    // RealtimeClient adds the "realtime:" prefix to the topic name; the
    // manager keys its state by the prefixed form.
    `realtime:wallet:${getCurrentUserId()}`;

  const buildChannel = () =>
    manager
      .channel(`wallet:${getCurrentUserId()}`, { private: true })
      .on('broadcast', { event: '*' }, ({ event, payload }) => {
        const handler = changeHandlers.find(
          (handler) => handler.event === event,
        );
        handler?.handleEvent(payload);
      });

  return {
    subscribe: async () => {
      const channel = manager.addChannel(buildChannel());
      await channel.subscribe(onConnected);
    },
    unsubscribe: async () => {
      await manager.removeChannel(getTopic(), { onConnected });
    },
    getStatus: () => manager.getChannelStatus(getTopic()) ?? 'idle',
    getError: () => manager.getChannelError(getTopic()),
    onStatusChange: (listener) =>
      manager.subscribeToChannelStatusChange(getTopic(), listener),
    setOnlineStatus: (isOnline) => manager.setOnlineStatus(isOnline),
    setActiveStatus: (isActive) => manager.setActiveStatus(isActive),
    internal: {
      manager,
    },
  };
}
