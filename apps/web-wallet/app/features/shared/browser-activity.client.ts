import type { ActivityMonitor } from '@agicash/wallet-sdk';

export function createBrowserActivity(): ActivityMonitor {
  let online = true;
  let trackingOnline = false;
  return {
    isActive: () => document.visibilityState !== 'hidden' && online,
    subscribe: (onChange) => {
      // The flag listeners live for the page's lifetime: an offline/online
      // flip between unsubscribe and the next subscribe must still land on
      // the flag, or a restarted task-processor loop that seeds from
      // isActive() never attempts take_lead again.
      if (!trackingOnline) {
        trackingOnline = true;
        window.addEventListener('offline', () => {
          online = false;
        });
        window.addEventListener('online', () => {
          online = true;
        });
      }
      const forward = () => {
        onChange();
      };
      window.addEventListener('visibilitychange', forward);
      window.addEventListener('offline', forward);
      window.addEventListener('online', forward);
      return () => {
        window.removeEventListener('visibilitychange', forward);
        window.removeEventListener('offline', forward);
        window.removeEventListener('online', forward);
      };
    },
  };
}

export const browserActivity = createBrowserActivity();
