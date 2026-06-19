import { useEffect, useSyncExternalStore } from 'react';
import { useSdk } from '~/features/shared/sdk';
import { SupabaseRealtimeError } from '~/lib/supabase';

/**
 * Drives the SDK's realtime wallet channel for the lifetime of the component
 * and surfaces a terminal channel error to the nearest error boundary. The SDK
 * owns the subscription itself — subscribing the current user's channel and
 * re-subscribing as the session changes — and dispatches DB change events to
 * its domain state; this hook just binds start/stop to the React lifecycle.
 */
export const useTrackWalletChanges = () => {
  const realtime = useSdk().realtime;

  const status = useSyncExternalStore(realtime.onStatusChange, () =>
    realtime.getStatus(),
  );

  useEffect(() => realtime.start(), [realtime]);

  if (status === 'error') {
    throw new SupabaseRealtimeError(
      'Realtime channel error',
      realtime.getError(),
    );
  }
};
