import { useEffect, useSyncExternalStore } from 'react';
import { getSdk } from '~/features/shared/sdk';
import { SupabaseRealtimeError } from '~/lib/supabase';

/**
 * Subscribes the SDK's wallet realtime channel for the lifetime of the
 * component. The SDK dispatches database change events to its domain state
 * and refetches on connect/reconnect; this hook only binds the channel to
 * the React lifecycle and surfaces a terminal channel error to the nearest
 * error boundary.
 */
export const useTrackWalletChanges = () => {
  const realtime = getSdk().realtime;

  const status = useSyncExternalStore(realtime.onStatusChange, () =>
    realtime.getStatus(),
  );

  useEffect(() => {
    const subscribePromise = realtime.subscribe().catch((error) => {
      console.error('Error subscribing to realtime channel', {
        cause: error,
      });
    });

    return () => {
      const cleanup = async () => {
        await subscribePromise;
        await realtime.unsubscribe();
      };

      cleanup().catch((error) => {
        console.error('Error cleaning up realtime channel', {
          cause: error,
        });
      });
    };
  }, [realtime]);

  if (status === 'error') {
    throw new SupabaseRealtimeError(
      'Realtime channel error',
      realtime.getError(),
    );
  }
};
