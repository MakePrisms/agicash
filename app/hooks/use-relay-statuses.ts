import { Relay } from 'applesauce-relay';
import { useEffect, useRef, useState } from 'react';
import { useDebounceValue as useDebouncedValue } from 'usehooks-ts';

export type RelayStatus = 'connecting' | 'connected' | 'failed';

export type RelayStatusInfo = {
  url: string;
  status: RelayStatus;
};

/**
 * Simple hook that tests relay connections by sending a subscription request.
 * Each relay is tested only once.
 */
export function useRelayStatuses(
  relayUrls: string[],
  debounceMs = 3000,
): RelayStatusInfo[] {
  const [debouncedRelayUrls] = useDebouncedValue(relayUrls, debounceMs);
  const [relayStatuses, setRelayStatuses] = useState<RelayStatusInfo[]>([]);

  // Use refs to store cleanup functions and avoid recreating objects
  const cleanupFunctionsRef = useRef<Map<string, () => void>>(new Map());
  const previousUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    // If URLs haven't changed, don't do anything
    const urlsChanged =
      debouncedRelayUrls.length !== previousUrlsRef.current.length ||
      debouncedRelayUrls.some(
        (url, index) => url !== previousUrlsRef.current[index],
      );

    if (!urlsChanged) {
      return;
    }

    previousUrlsRef.current = [...debouncedRelayUrls];

    // Clean up any existing connections
    cleanupFunctionsRef.current.forEach((cleanup) => cleanup());
    cleanupFunctionsRef.current.clear();

    if (debouncedRelayUrls.length === 0) {
      setRelayStatuses([]);
      return;
    }

    // Initialize all relays as connecting
    const initialStatuses: RelayStatusInfo[] = debouncedRelayUrls.map(
      (url) => ({
        url,
        status: 'connecting',
      }),
    );
    setRelayStatuses(initialStatuses);

    // Test each relay
    debouncedRelayUrls.forEach((url) => {
      const relayInstance = new Relay(url, {
        keepAlive: 5,
      });

      // Set timeout for failure (5 seconds)
      const timeout = setTimeout(() => {
        setRelayStatuses((prev) =>
          prev.map((status) =>
            status.url === url ? { ...status, status: 'failed' } : status,
          ),
        );
        relayInstance.close();
      }, 5000);

      // Make a test subscription request
      const subscription = relayInstance
        .request({
          kinds: [1],
          limit: 1,
        })
        .subscribe({
          next: () => {
            // Got a response - relay is connected
            clearTimeout(timeout);
            setRelayStatuses((prev) =>
              prev.map((status) =>
                status.url === url
                  ? { ...status, status: 'connected' }
                  : status,
              ),
            );
            subscription.unsubscribe();
            relayInstance.close();
          },
          error: () => {
            // Request failed - relay is failed
            clearTimeout(timeout);
            setRelayStatuses((prev) =>
              prev.map((status) =>
                status.url === url ? { ...status, status: 'failed' } : status,
              ),
            );
            relayInstance.close();
          },
        });

      // Store cleanup function
      cleanupFunctionsRef.current.set(url, () => {
        clearTimeout(timeout);
        subscription.unsubscribe();
        relayInstance.close();
      });
    });

    // Return cleanup function for the effect
    return () => {
      cleanupFunctionsRef.current.forEach((cleanup) => cleanup());
      cleanupFunctionsRef.current.clear();
    };
  }, [debouncedRelayUrls]);

  return relayStatuses;
}
