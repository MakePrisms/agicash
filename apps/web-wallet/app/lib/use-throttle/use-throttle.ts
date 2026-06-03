import { useEffect, useRef } from 'react';
import { useLatest } from '~/lib/use-latest';

type ThrottleOptions = {
  /** Fire immediately on the first call. Defaults to `true`. */
  leading?: boolean;
  /** Fire on trailing edge after the delay expires. Defaults to `true`. */
  trailing?: boolean;
};

/**
 * Creates a throttled version of a function that fires at most once per
 * `delayMs`. By default both leading and trailing edges are enabled: the first
 * call fires immediately and the last call during the delay fires when it
 * expires.
 */
export function createThrottle<A extends unknown[]>(
  getCallback: () => (...args: A) => void,
  delayMs: number,
  { leading = true, trailing = true }: ThrottleOptions = {},
): { throttled: (...args: A) => void; cancel: () => void } {
  let lastCallTime = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let latestArgs: A | null = null;

  const throttled = (...args: A) => {
    const now = Date.now();
    const remaining = delayMs - (now - lastCallTime);

    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCallTime = now;
      if (leading) {
        getCallback()(...args);
      } else {
        latestArgs = args;
      }
    }

    if (remaining > 0 || !leading) {
      if (trailing && !timeoutId) {
        latestArgs = latestArgs ?? args;
        timeoutId = setTimeout(
          () => {
            lastCallTime = Date.now();
            timeoutId = null;
            getCallback()(...(latestArgs as A));
            latestArgs = null;
          },
          remaining > 0 ? remaining : delayMs,
        );
      } else if (trailing) {
        latestArgs = args;
      }
    }
  };

  const cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    latestArgs = null;
  };

  return { throttled, cancel };
}

/**
 * Returns a throttled version of the callback that fires at most once per
 * `delayMs`. By default both leading and trailing edges are enabled: the first
 * call fires immediately and the last call during the delay fires when it
 * expires.
 *
 * Always invokes the latest version of `callback` (via `useLatest`), and the
 * returned function is referentially stable so it's safe to call from effects.
 * The trailing timeout is automatically cleaned up on unmount.
 */
export function useThrottle<A extends unknown[]>(
  callback: (...args: A) => void,
  delayMs: number,
  options?: ThrottleOptions,
): (...args: A) => void {
  const callbackRef = useLatest(callback);

  const { throttled, cancel } = useRef(
    createThrottle(() => callbackRef.current, delayMs, options),
  ).current;

  useEffect(() => cancel, [cancel]);

  return throttled;
}
