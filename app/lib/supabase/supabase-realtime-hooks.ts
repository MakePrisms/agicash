import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useLatest } from '../use-latest';
import type { RealtimeChannelBuilder } from './supabase-realtime-channel-builder';
import type {
  ChannelStatus,
  SupabaseRealtimeManager,
} from './supabase-realtime-manager';

/**
 * Error thrown when a Supabase Realtime channel fails to connect.
 */
export class SupabaseRealtimeError extends Error {
  constructor(
    message: string,
    public readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'SupabaseRealtimeError';
  }
}

/**
 * Checks if the device is online.
 * @returns True if the device is online, false otherwise.
 */
const isOnline = (): boolean =>
  typeof navigator !== 'undefined' && navigator.onLine !== false;

/**
 * Checks if the tab is active.
 * @returns True if the tab is active, false otherwise.
 */
const isTabActive = (): boolean =>
  typeof document !== 'undefined' && !document.hidden;

interface Options {
  /**
   * A channel builder that configures the Supabase Realtime channel to subscribe to.
   * Any change to the builder after the component mounts will be ignored.
   */
  channel: RealtimeChannelBuilder;
  /**
   * A callback that is called when the channel is initially connected or reconnected.
   * Use if you need to refresh the data to catch up with the latest changes.
   * Doesn't require stable reference. The hook will always use the latest value of the callback.
   */
  onConnected?: () => void;
}

/**
 * Hook that subscribes to a Supabase Realtime channel to receive realtime updates.
 * The channel is created when the component mounts and unsubscribed when the component unmounts.
 * Note that any changes to the channel configuration after the component mounts will be ignored.
 * @param options Options for the hook
 * @returns The current status of the channel
 */
export function useSupabaseRealtime({
  channel: channelBuilder,
  onConnected,
}: Options): ChannelStatus {
  const channelBuilderRef = useRef(channelBuilder);
  const onConnectedRef = useLatest(onConnected);

  const getChannelStatus = useCallback(() => {
    const { topic, manager } = channelBuilderRef.current;
    return manager.getChannelStatus(topic) ?? 'idle';
  }, []);

  const subscribeToChannelStatusChange = useCallback((listener: () => void) => {
    const { topic, manager } = channelBuilderRef.current;
    return manager.subscribeToChannelStatusChange(topic, listener);
  }, []);

  const status = useSyncExternalStore(
    subscribeToChannelStatusChange,
    getChannelStatus,
  );

  useEffect(() => {
    const builder = channelBuilderRef.current;
    const { manager } = builder;

    const onConnectedCallback = () => onConnectedRef.current?.();

    const channel = manager.addChannel(builder);
    const subscribePromise = channel
      .subscribe(onConnectedCallback)
      .catch((error) => {
        console.error('Error subscribing to realtime channel', {
          error,
          topic: channel.topic,
        });
      });

    return () => {
      const cleanup = async () => {
        await subscribePromise;
        await channel.unsubscribe(onConnectedCallback);
      };

      cleanup().catch((error) => {
        console.error('Error cleaning up realtime channel', {
          error,
          topic: channel.topic,
        });
      });
    };
  }, []);

  if (status === 'error') {
    const { topic, manager } = channelBuilderRef.current;
    const error = manager.getChannelError(topic);
    throw new SupabaseRealtimeError('Realtime channel error', error);
  }

  return status;
}

/**
 * Tracks the online and active status of the app and sets the status on the Supabase Realtime manager.
 * This should be called once at the app level to ensure all realtime channels are resubscribed when the app becomes online and active again.
 */
export function useSupabaseRealtimeActivityTracking(
  realtimeManager: SupabaseRealtimeManager,
) {
  useEffect(() => {
    realtimeManager.setOnlineStatus(isOnline());
    realtimeManager.setActiveStatus(isTabActive());

    const handleOnline = () => realtimeManager.setOnlineStatus(true);
    const handleOffline = () => realtimeManager.setOnlineStatus(false);
    const handleVisibilityChange = () =>
      realtimeManager.setActiveStatus(isTabActive());

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [realtimeManager]);
}
