// Max setTimeout delay (~24.8 days).
// See https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value
const maxSetTimeoutDelay = 2 ** 31 - 1;

export type LongTimeout = {
  id: ReturnType<typeof setTimeout> | null; // Tracks the latest timeout ID
};

/**
 * setTimeout alternative that supports bigger delays. Default setTimeout only supports delay up to ~24.8 days.
 * @param callback Callback to be invoked after the delay
 * @param delay Delay after which callback should be executed
 * @returns {LongTimeout}. To clear the long timeout use `clearLongTimeout` function
 */
export function setLongTimeout(
  callback: () => void,
  delay: number,
): LongTimeout {
  const start = Date.now();

  const longTimeout: LongTimeout = { id: null };

  function scheduleNext() {
    const elapsed = Date.now() - start;

    if (elapsed >= delay) {
      callback();
    } else {
      const remaining = delay - elapsed;
      longTimeout.id = setTimeout(
        scheduleNext,
        Math.min(remaining, maxSetTimeoutDelay),
      );
    }
  }

  scheduleNext();

  return longTimeout;
}

/**
 * Clears the long timeout
 * @param longTimeout
 */
export function clearLongTimeout(longTimeout: LongTimeout) {
  if (longTimeout.id !== null) {
    clearTimeout(longTimeout.id);
    longTimeout.id = null;
  }
}
