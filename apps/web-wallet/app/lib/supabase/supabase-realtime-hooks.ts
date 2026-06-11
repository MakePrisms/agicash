import { useEffect } from 'react';

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

type ActivityTarget = {
  setOnlineStatus: (isOnline: boolean) => void;
  setActiveStatus: (isActive: boolean) => void;
};

/**
 * Tracks the online and active status of the app and sets the status on the target
 * (the SDK realtime api or a Supabase Realtime manager).
 * This should be called once at the app level to ensure all realtime channels are
 * resubscribed when the app becomes online and active again.
 */
export function useSupabaseRealtimeActivityTracking(target: ActivityTarget) {
  useEffect(() => {
    target.setOnlineStatus(isOnline());
    target.setActiveStatus(isTabActive());

    const handleOnline = () => target.setOnlineStatus(true);
    const handleOffline = () => target.setOnlineStatus(false);
    const handleVisibilityChange = () => target.setActiveStatus(isTabActive());

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [target]);
}
