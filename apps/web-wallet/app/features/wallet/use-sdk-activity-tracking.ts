import type { StatelessSdk } from '@agicash/wallet-sdk/stateless';
import { useEffect } from 'react';

/** Always present on the stateless engine (injected at construction). */
type Background = NonNullable<StatelessSdk['background']>;

const isOnline = (): boolean =>
  typeof navigator !== 'undefined' && navigator.onLine !== false;

const isTabActive = (): boolean =>
  typeof document !== 'undefined' && !document.hidden;

/**
 * Forwards browser online/offline + tab-visibility changes to the SDK's
 * background domain so realtime channels pause/resume and leadership yields
 * when the tab is backgrounded. Seeds the current status on mount.
 */
export function useSDKActivityTracking(background: Background) {
  useEffect(() => {
    background.setOnlineStatus(isOnline());
    background.setActiveStatus(isTabActive());

    const handleOnline = () => background.setOnlineStatus(true);
    const handleOffline = () => background.setOnlineStatus(false);
    const handleVisibilityChange = () =>
      background.setActiveStatus(isTabActive());

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [background]);
}
