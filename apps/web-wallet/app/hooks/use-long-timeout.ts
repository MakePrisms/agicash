import { useEffect } from 'react';
import { clearLongTimeout, setLongTimeout } from '~/lib/timeout';
import { useLatest } from '~/lib/use-latest';

/**
 * Custom hook that handles long timeouts in React components using the `setLongTimeout API`.
 * The code of useLongTimeout is copied from [`usehooks-ts` lib](https://github.com/juliencrn/usehooks-ts/blob/master/packages/usehooks-ts/src/useTimeout/useTimeout.ts)
 * and calls to setTimeout and clearTimeout were replaced with long timeout alternatives.
 * Support arbitrary delays.
 * @param {() => void} callback - The function to be executed when the timeout elapses.
 * @param {number | null} delay - The duration (in milliseconds) for the timeout. Set to `null` to clear the timeout.
 * @returns {void} This hook does not return anything.
 * @public
 * @example
 * ```tsx
 * // Usage of useLongTimeout hook
 * useLongTimeout(() => {
 *   // Code to be executed after the specified delay
 * }, 1000); // Set a timeout of 1000 milliseconds (1 second)
 * ```
 */
export function useLongTimeout(
  callback: () => void,
  delay: number | null,
): void {
  // Remember the latest callback if it changes.
  const savedCallback = useLatest(callback);

  // Set up the timeout.
  useEffect(() => {
    // Don't schedule if no delay is specified.
    // Note: 0 is a valid value for delay.
    if (!delay && delay !== 0) {
      return;
    }

    const id = setLongTimeout(() => {
      savedCallback.current();
    }, delay);

    return () => {
      clearLongTimeout(id);
    };
  }, [delay]);
}
