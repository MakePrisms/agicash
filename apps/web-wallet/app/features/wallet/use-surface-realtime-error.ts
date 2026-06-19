import { useSyncExternalStore } from 'react';
import { useSdk } from '~/features/shared/sdk';
import { SupabaseRealtimeError } from '~/lib/supabase';

/**
 * Surfaces a terminal realtime-channel error to the nearest error boundary. The
 * SDK owns the channel subscription (started by sdk.start()); this hook only
 * reads its status and escalates a channel error to React.
 */
export const useSurfaceRealtimeError = () => {
  const realtime = useSdk().realtime;

  const status = useSyncExternalStore(realtime.onStatusChange, () =>
    realtime.getStatus(),
  );

  if (status === 'error') {
    throw new SupabaseRealtimeError(
      'Realtime channel error',
      realtime.getError(),
    );
  }
};
