const maxSetTimeoutDelay = 2 ** 31 - 1;

export type LongTimeout = { id: ReturnType<typeof setTimeout> | null };

/** setTimeout that supports delays beyond ~24.8 days by re-scheduling in chunks. */
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

export function clearLongTimeout(longTimeout: LongTimeout) {
  if (longTimeout.id !== null) {
    clearTimeout(longTimeout.id);
    longTimeout.id = null;
  }
}
