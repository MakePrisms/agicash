export type DelayOptions = {
  signal?: AbortSignal;
};

/**
 * Waits for the specified num of milliseconds
 * @param ms Number of milliseconds to wait
 * @param signal Abort signal that can be used to cancel the delay
 */
export default async function delay(
  ms: number,
  { signal }: DelayOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal) {
      signal.throwIfAborted();
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    function abortHandler() {
      clearTimeout(timeoutId);
      reject((signal?.reason as Error) ?? new Error('Delay aborted'));
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', abortHandler);
      resolve();
    }, ms);
  });
}
