import {
  REALTIME_LISTEN_TYPES,
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeChannel,
} from '@supabase/supabase-js';
import { agicashDb } from 'app/features/agicash-db/database';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatest } from '../use-latest';

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

/**
 * Refreshes the realtime client access token if it has expired.
 */
const refreshSessionIfNeeded = async () => {
  // setAuth calls accessToken method on the Supabase client which fetches the existing token if still valid or fetches a new one if expired.
  // It then sees if the token returned from accessToken method has changed and if it did, it updates the realtime access token.
  await agicashDb.realtime.setAuth();
};

const isOnline = (): boolean =>
  typeof navigator !== 'undefined' && navigator.onLine !== false;

const isTabActive = (): boolean =>
  typeof document !== 'undefined' && !document.hidden;

const maxRetries = 3;

/**
 * Subscribes to a Supabase Realtime channel when the component mounts and unsubscribes when the component unmounts.
 * Manages channel reconnection in case of errors and timeouts which can be caused by the tab going to the background, network connection issues, phone pausing the
 * execution of the app when in background, etc.
 *
 * @description
 * Hook's lifecycle starts in the 'subscribing' status and subscription is triggered on mount. When the hook is unmounted, the subscription is unsubscribed.
 *
 * 1. The hook listens to the changes of the channel status and acts accordingly:
 * - If the status is 'CLOSED', the hook unsubscribes from the channel.
 * - If the status is 'CHANNEL_ERROR' or 'TIMED_OUT':
 *   - If the tab is visible and the app is online, the hook retries the subscription (up to {@link maxRetries} times). During the retries the hook status is set to 'reconnecting'. If all the
 *     retries fail, the hook status is set to 'error' and the hook throws the error which is then caught by the error boundary.
 *   - If the tab is not visible (in the background) or the app is offline, the hook unsubscribes from the channel, which results in channel being closed and hook status being
 *     set to 'closed'.
 * - If the status is 'SUBSCRIBED', the hook does nothing and waits for the system postgres_changes ok message to be received (see https://github.com/supabase/realtime/issues/282
 *   for explanation and {@link setupSystemMessageListener} for implementation). Only when this message is received, the postgres_changes subscription is fully established, so
 *   the hook state is set to 'subscribed'. Every time when the system postgres_changes ok message is received (after the initial subscription or after resubscription), the hook
 *   calls the {@link onConnected} callback.
 *
 * 2. The hook listens for the visibility change of the tab and resubscribes to the channel if the tab is visible, the app is online and the channel is not already in 'joined'
 *    or 'joining' state. This makes sure that if the channel was closed while in background (either by our error/timeout handling or by the browser/machine), it will be
 *    reconnected when the tab is visible again.
 *
 * 3. The hook listens for the online status of the browser and resubscribes to the channel if the app comes back online, the tab is visible and the channel is not already
 *    in 'joined' or 'joining' state. This makes sure that if the channel was closed due to the lost network connection, it will be reconnected when the app comes back online.
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
  const retryCountRef = useRef(0);

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
        retryCountRef.current = 0; // Reset retries on success

        console.debug('Channel connected', {
          time: new Date().toISOString(),
          topic: channel.topic,
        });
      }
    });
  }, []);

  const subscribe = useCallback(async () => {
    await refreshSessionIfNeeded();

    const channel = channelFactoryRef.current();
    channelRef.current = channel;

    console.debug('Realtime channel subscribe called', {
      time: new Date().toISOString(),
      topic: channel.topic,
    });

    setupSystemMessageListener(channel);

    channel.subscribe((status, err) =>
      handleSubscriptionState(channel, status, err),
    );
  }, [setupSystemMessageListener]);

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      console.debug('Realtime channel unsubscribe called', {
        time: new Date().toISOString(),
        topic: channelRef.current.topic,
      });
      agicashDb.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  const resubscribe = useCallback(() => {
    console.debug('Realtime channel resubscribe called', {
      time: new Date().toISOString(),
      topic: channelRef.current?.topic,
    });
    unsubscribe();
    subscribe();
  }, [unsubscribe, subscribe]);

  const handleSubscriptionState = useCallback(
    async (channel: RealtimeChannel, status: string, supabaseError?: Error) => {
      const { topic } = channel;
      console.debug('Realtime channel subscription status changed', {
        time: new Date().toISOString(),
        topic,
        status,
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
          console.debug(
            `Channel ${event}, but tab is not active or app is offline. Unsubscribing.`,
            {
              time: new Date().toISOString(),
              topic,
              status,
              error: supabaseError,
              isTabActive: tabActive,
              isOnline: online,
            },
          );
          unsubscribe();
          return;
        }

        if (retryCountRef.current < maxRetries) {
          setState({
            status: 'reconnecting',
            error:
              supabaseError ??
              new Error(
                `Error with "${channel.topic}" channel subscription. Status: ${status}`,
              ),
          });

          retryCountRef.current += 1;
          console.debug(`Retrying subscription after ${event}`, {
            time: new Date().toISOString(),
            topic,
            status,
            error: supabaseError,
            attempt: `${retryCountRef.current}/${maxRetries}`,
          });
          resubscribe();
        } else {
          setState({
            status: 'error',
            error: new Error(
              `Error with "${channel.topic}" channel subscription. Status: ${status}`,
              { cause: supabaseError },
            ),
          });
        }
      }
    },
    [resubscribe, unsubscribe],
  );

  const handleVisibilityChangeRef = useLatest(() => {
    if (isTabActive()) {
      const online = isOnline();

      console.debug('Tab is active again', {
        time: new Date().toISOString(),
        status: state.status,
        topic: channelRef.current?.topic,
        channelState: channelRef.current?.state,
        isOnline: online,
      });

      const isJoinedOrJoining =
        channelRef.current?.state === 'joined' ||
        channelRef.current?.state === 'joining';

      if (online && !isJoinedOrJoining) {
        retryCountRef.current = 0;
        resubscribe();
      }
    }
  });

  const handleOnlineRef = useLatest(() => {
    const tabActive = isTabActive();
    console.debug('App is online again', {
      time: new Date().toISOString(),
      status: state.status,
      topic: channelRef.current?.topic,
      channelState: channelRef.current?.state,
      isTabActive: tabActive,
    });

    if (tabActive) {
      const isJoinedOrJoining =
        channelRef.current?.state === 'joined' ||
        channelRef.current?.state === 'joining';

      if (!isJoinedOrJoining) {
        retryCountRef.current = 0;
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
      unsubscribe();
    };
  }, [subscribe, unsubscribe]);

  if (state.status === 'error') {
    throw state.error;
  }

  return state.status;
}
