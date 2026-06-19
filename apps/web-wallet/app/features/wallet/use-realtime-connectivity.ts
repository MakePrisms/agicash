import type { Sdk } from '@agicash/wallet-sdk';
import { useEffect } from 'react';
import { useSdk } from '~/features/shared/use-sdk';

/**
 * Forwards the browser's online/active status to `sdk.background.setConnectivity`
 * so the SDK's realtime manager can resubscribe and catch up after the tab comes
 * back online or visible. Ports the old `useSupabaseRealtimeActivityTracking`
 * (`window` online/offline + `document` visibilitychange) onto the SDK.
 */
export function useRealtimeConnectivity(): void {
  const sdkPromise = useSdk();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let sdkRef: Sdk | undefined;
    let disposed = false;

    const push = () => {
      sdkRef?.background.setConnectivity({
        online: navigator.onLine !== false,
        active: !document.hidden,
      });
    };

    const handleOnline = () =>
      sdkRef?.background.setConnectivity({
        online: true,
        active: !document.hidden,
      });
    const handleOffline = () =>
      sdkRef?.background.setConnectivity({
        online: false,
        active: !document.hidden,
      });
    const handleVisibilityChange = () => push();

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    void sdkPromise.then((sdk) => {
      if (disposed) return;
      sdkRef = sdk;
      push();
    });

    return () => {
      disposed = true;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sdkPromise]);
}
