import {
  REALTIME_LISTEN_TYPES,
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeChannel,
} from '@supabase/supabase-js';
import { agicashDb } from 'app/features/agicash-db/database';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatest } from '../use-latest';

// Global retry manager to coordinate all realtime subscriptions
class RealtimeRetryManager {
  private retryCount = 0;
  private maxRetries = 5; // Increased from 3
  private isRefreshingAuth = false;
  private refreshPromise: Promise<void> | null = null;

  async refreshSessionIfNeeded(): Promise<void> {
    if (this.isRefreshingAuth && this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshingAuth = true;
    this.refreshPromise = agicashDb.realtime.setAuth().finally(() => {
      this.isRefreshingAuth = false;
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  canRetry(): boolean {
    return this.retryCount < this.maxRetries;
  }

  incrementRetry(): void {
    this.retryCount++;
  }

  resetRetries(): void {
    this.retryCount = 0;
  }

  getRetryDelay(): number {
    // Exponential backoff with jitter: base delay 1s, max 30s
    const baseDelay = 1000;
    const maxDelay = 30000;
    const exponentialDelay = Math.min(
      baseDelay * 2 ** this.retryCount,
      maxDelay,
    );
    // Add jitter (±25%)
    const jitter = exponentialDelay * 0.25 * (Math.random() - 0.5);
    return exponentialDelay + jitter;
  }

  get currentRetryCount(): number {
    return this.retryCount;
  }

  get currentMaxRetries(): number {
    return this.maxRetries;
  }
}

const globalRetryManager = new RealtimeRetryManager();

interface Options {
  /**
   *  A function that returns the Supabase Realtime channel to subscribe to.
   */
  channelFactory: () => RealtimeChannel;
  /**
   * A callback that is called when the channel is initally connected or reconnected. Use if you need to refresh the data to catch up with the latest changes.
   */
  onConnected?: () => void;
}

/**
 * The state of the subscription:
 * - 'subscribing' - the channel is being initially subscribed to.
 * - 'subscribed' - the channel is subscribed and the connection is fully established for postgres_changes.
 * - 'reconnecting' - the channel is reconnecting after an error or timeout.
 * - 'closed' - the channel is closed.
 * - 'error' - the channel is in an error state (all reconnection attempts failed). The error is thrown.
 */
type SubscriptionState =
  | {
      status: 'subscribing' | 'subscribed' | 'closed';
    }
  | {
      status: 'error' | 'reconnecting';
      error: Error;
    };
const isOnline = (): boolean =>
  typeof navigator !== 'undefined' && navigator.onLine !== false;

const isTabActive = (): boolean =>
  typeof document !== 'undefined' && !document.hidden;

/**
 * Subscribes to a Supabase Realtime channel when the component mounts and unsubscribes when the component unmounts.
 * Manages channel reconnection in case of errors and timeouts which can be caused by the tab going to the background, network connection issues, phone pausing the
 * execution of the app when in background, etc.
 *
 * @description
 * Hook's lifecycle starts in the 'subscribing' status and subscription is triggered on mount. When the hook is unmounted, the subscription is unsubscribed.
 *
 * Uses a global retry manager to coordinate retries across all realtime subscriptions, preventing race conditions and implementing exponential backoff.
 *
 * 1. The hook listens to the changes of the channel status and acts accordingly:
 * - If the status is 'CLOSED', the hook unsubscribes from the channel.
 * - If the status is 'CHANNEL_ERROR' or 'TIMED_OUT':
 *   - If the tab is visible and the app is online, the hook retries the subscription using global retry coordination with exponential backoff. During the retries the hook status is set to 'reconnecting'. If all the
 *     retries fail, the hook status is set to 'error' and the hook throws the error which is then caught by the error boundary.
 *   - If the tab is not visible (in the background) or the app is offline, the hook unsubscribes from the channel, which results in channel being closed and hook status being
 *     set to 'closed'.
 * - If the status is 'SUBSCRIBED', the hook does nothing and waits for the system postgres_changes ok message to be received (see https://github.com/supabase/realtime/issues/282
 *   for explanation and {@link setupSystemMessageListener} for implementation). Only when this message is received, the postgres_changes subscription is fully established, so
 *   the hook state is set to 'subscribed'. Every time when the system postgres_changes ok message is received (after the initial subscription or after resubscription), the hook
 *   calls the {@link onConnected} callback.
 *
 * 2. The hook listens for the visibility change of the tab and resubscribes to the channel if the tab is visible, the app is online and the channel is in 'closed' or 'error' state.
 *    This makes sure that if the channel was closed while in background, it will be reconnected when the tab is visible again.
 *
 * 3. The hook listens for the online status of the browser and resubscribes to the channel if the app comes back online, the tab is visible and the channel is in 'closed' or 'error' state.
 *    This makes sure that if the channel was closed due to the lost network connection, it will be reconnected when the app comes back online.
 *
 * @param options - Subscription configuration.
 * @returns The status of the subscription.
 * @throws {Error} If the subscription errors while the app is in the foreground and all the retries fail.
 */
export function useSupabaseRealtimeSubscription({
  channelFactory,
  onConnected,
}: Options) {
  const [state, setState] = useState<SubscriptionState>({
    status: 'subscribing',
  });
  const channelRef = useRef<RealtimeChannel | null>(null);
  const onConnectedRef = useLatest(onConnected);
  const channelFactoryRef = useLatest(channelFactory);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Listens for the system postgres_changes ok message and sets the subscription state to 'subscribed' when it is received.
   * Only when this message is received, we can be sure that the connection is fully established for postgres_changes.
   * See https://github.com/supabase/realtime/issues/282 for details.
   */
  const setupSystemMessageListener = useCallback((channel: RealtimeChannel) => {
    channel.on(REALTIME_LISTEN_TYPES.SYSTEM, {}, (payload) => {
      if (payload.extension === 'postgres_changes' && payload.status === 'ok') {
        onConnectedRef.current?.();

        setState({ status: 'subscribed' });
        globalRetryManager.resetRetries(); // Reset global retries on success

        const now = Date.now();
        console.debug('Channel connected', {
          time: new Date(now).toISOString(),
          timestamp: now,
          topic: channel.topic,
        });
      }
    });
  }, []);

  const subscribe = useCallback(
    async (resubscriptionId?: string) => {
      try {
        await globalRetryManager.refreshSessionIfNeeded();

        const channel = channelFactoryRef.current();
        channelRef.current = channel;

        const now = Date.now();
        console.debug('Realtime channel subscribe called', {
          time: new Date(now).toISOString(),
          timestamp: now,
          topic: channel.topic,
          resubscriptionId: resubscriptionId ?? '-',
          socketConnectionState: channel.socket.connectionState().toString(),
        });

        setupSystemMessageListener(channel);

        channel.subscribe((status, err) =>
          handleSubscriptionState(channel, status, err),
        );
      } catch (error) {
        console.error('Failed to subscribe to channel:', error);
        setState({
          status: 'error',
          error:
            error instanceof Error
              ? error
              : new Error('Unknown subscription error'),
        });
      }
    },
    [setupSystemMessageListener],
  );

  const unsubscribe = useCallback(async (resubscriptionId?: string) => {
    if (channelRef.current) {
      const now = Date.now();
      console.debug('Realtime channel unsubscribe called', {
        time: new Date(now).toISOString(),
        timestamp: now,
        topic: channelRef.current.topic,
        resubscriptionId: resubscriptionId ?? '-',
        socketConnectionState: channelRef.current.socket
          .connectionState()
          .toString(),
      });
      const result = await agicashDb.removeChannel(
        channelRef.current,
        // @ts-ignore - this was patched with bun patch but for some reason typescript is not picking it up.
        resubscriptionId,
      );
      console.debug('Realtime channel unsubscribe result', {
        time: new Date(now).toISOString(),
        timestamp: now,
        topic: channelRef.current.topic,
        resubscriptionId: resubscriptionId ?? '-',
        result,
        socketConnectionState: channelRef.current.socket
          .connectionState()
          .toString(),
      });
      channelRef.current = null;
    }
  }, []);

  const resubscribe = useCallback(async () => {
    const resubscriptionId = crypto.randomUUID();
    const now = Date.now();
    console.debug('Realtime channel resubscribe called', {
      time: new Date(now).toISOString(),
      timestamp: now,
      topic: channelRef.current?.topic,
      id: resubscriptionId,
    });
    await unsubscribe(resubscriptionId);
    subscribe(resubscriptionId);
  }, [unsubscribe, subscribe]);

  const handleSubscriptionState = useCallback(
    async (channel: RealtimeChannel, status: string, supabaseError?: Error) => {
      const { topic } = channel;
      let now = Date.now();
      console.debug('Realtime channel subscription status changed', {
        time: new Date(now).toISOString(),
        timestamp: now,
        topic,
        status,
        socketConnectionState: channel.socket.connectionState().toString(),
        error: supabaseError,
      });

      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        // We are doing nothing here because this doesn't really mean that the connection is fully established for postgres_changes.
        // We need to wait for the system postgres_changes ok message to be received.
        // See setupSystemMessageListener method above.
      } else if (status === REALTIME_SUBSCRIBE_STATES.CLOSED) {
        setState({ status: 'closed' });
      } else if (
        status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
        status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
      ) {
        const event =
          status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR
            ? 'error'
            : 'timeout';
        const tabActive = isTabActive();
        const online = isOnline();

        if (!online || !tabActive) {
          now = Date.now();
          console.debug(
            `Channel ${event}, but tab is not active or app is offline. Unsubscribing.`,
            {
              time: new Date(now).toISOString(),
              timestamp: now,
              topic,
              status,
              error: supabaseError,
              isTabActive: tabActive,
              isOnline: online,
              socketConnectionState: channel.socket
                .connectionState()
                .toString(),
            },
          );
          unsubscribe();
          return;
        }

        // Clear any existing retry timeout
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = null;
        }

        if (globalRetryManager.canRetry()) {
          const error =
            supabaseError ??
            new Error(
              `Error with "${channel.topic}" channel subscription. Status: ${status}`,
            );

          setState({
            status: 'reconnecting',
            error,
          });

          globalRetryManager.incrementRetry();
          const retryDelay = globalRetryManager.getRetryDelay();

          now = Date.now();
          console.debug(`Retrying subscription after ${event}`, {
            time: new Date(now).toISOString(),
            timestamp: now,
            topic,
            status,
            error: supabaseError,
            socketConnectionState: channel.socket.connectionState().toString(),
            attempt: `${globalRetryManager.currentRetryCount}/${globalRetryManager.currentMaxRetries}`,
            retryDelay,
          });

          retryTimeoutRef.current = setTimeout(() => {
            retryTimeoutRef.current = null;
            resubscribe();
          }, retryDelay);
        } else {
          const finalError = new Error(
            `Error with "${channel.topic}" channel subscription. Status: ${status}. All retries exhausted.`,
            { cause: supabaseError },
          );

          setState({
            status: 'error',
            error: finalError,
          });

          now = Date.now();
          console.error('Realtime subscription failed after all retries', {
            time: new Date(now).toISOString(),
            timestamp: now,
            topic,
            status,
            error: supabaseError,
            socketConnectionState: channel.socket.connectionState().toString(),
          });
        }
      }
    },
    [resubscribe, unsubscribe],
  );

  const handleVisibilityChangeRef = useLatest(() => {
    if (isTabActive()) {
      const online = isOnline();
      const now = Date.now();

      console.debug('Tab is active again', {
        time: new Date(now).toISOString(),
        timestamp: now,
        status: state.status,
        topic: channelRef.current?.topic,
        channelState: channelRef.current?.state,
        socketConnectionState: channelRef.current?.socket
          .connectionState()
          .toString(),
        isOnline: online,
      });

      const isJoinedOrJoining =
        channelRef.current?.state === 'joined' ||
        channelRef.current?.state === 'joining';

      // Only resubscribe if we're in a closed or error state and not already retrying
      if (
        online &&
        !isJoinedOrJoining &&
        (state.status === 'closed' || state.status === 'error') &&
        !retryTimeoutRef.current
      ) {
        globalRetryManager.resetRetries();
        resubscribe();
      }
    }
  });

  const handleOnlineRef = useLatest(() => {
    const tabActive = isTabActive();
    const now = Date.now();
    console.debug('App is online again', {
      time: new Date(now).toISOString(),
      timestamp: now,
      status: state.status,
      topic: channelRef.current?.topic,
      channelState: channelRef.current?.state,
      socketConnectionState: channelRef.current?.socket
        .connectionState()
        .toString(),
      isTabActive: tabActive,
    });

    if (tabActive) {
      const isJoinedOrJoining =
        channelRef.current?.state === 'joined' ||
        channelRef.current?.state === 'joining';

      // Only resubscribe if we're in a closed or error state and not already retrying
      if (
        !isJoinedOrJoining &&
        (state.status === 'closed' || state.status === 'error') &&
        !retryTimeoutRef.current
      ) {
        globalRetryManager.resetRetries();
        resubscribe();
      }
    }
  });

  useEffect(() => {
    const handleVisibility = () => handleVisibilityChangeRef.current();
    const handleOnline = () => handleOnlineRef.current();

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    subscribe();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);

      // Clean up retry timeout
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }

      unsubscribe();
    };
  }, [subscribe, unsubscribe]);

  if (state.status === 'error') {
    throw state.error;
  }

  return state.status;
}
