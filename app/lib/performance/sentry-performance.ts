import * as Sentry from '@sentry/react-router';

/**
 * Wraps an async operation with both Performance API marks and a Sentry span.
 * This maintains backward compatibility with existing performance.mark/measure patterns
 * while sending data to Sentry.
 *
 * @param name - The operation name (used for both Performance API and Sentry)
 * @param operation - The async operation to measure
 * @param attributes - Optional attributes to attach to the Sentry span
 */
export async function measureOperation<T>(
  name: string,
  operation: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  const startMark = `${name}-start`;
  const endMark = `${name}-end`;

  // Performance API marks for backward compatibility and browser DevTools visibility
  performance.mark(startMark);

  try {
    // Wrap in Sentry span for reporting
    return await Sentry.startSpan(
      {
        name,
        op: 'custom',
        attributes,
      },
      async () => operation(),
    );
  } finally {
    performance.mark(endMark);
    performance.measure(name, startMark, endMark);
  }
}
