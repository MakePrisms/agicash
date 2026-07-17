// Max setTimeout delay (~24.8 days).
// See https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value
const maxSetTimeoutDelay = 2 ** 31 - 1;

export type LongTimeout = {
  id: ReturnType<typeof setTimeout> | null; // Tracks the latest timeout ID
};

/**
 * setTimeout alternative that supports delays beyond setTimeout's ~24.8 day
 * cap. Like setTimeout, the callback always runs asynchronously: a delay of 0
 * or less schedules it on the next tick rather than invoking it inline.
 * @param callback Callback to be invoked after the delay
 * @param delay Delay in milliseconds after which the callback runs
 * @returns {LongTimeout}. To clear the long timeout use `clearLongTimeout` function
 */
export function setLongTimeout(
  callback: () => void,
  delay: number,
): LongTimeout {
  const start = Date.now();

  const longTimeout: LongTimeout = { id: null };

  function scheduleNext() {
    const remaining = delay - (Date.now() - start);
    if (remaining > maxSetTimeoutDelay) {
      longTimeout.id = setTimeout(scheduleNext, maxSetTimeoutDelay);
    } else {
      longTimeout.id = setTimeout(callback, Math.max(remaining, 0));
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
