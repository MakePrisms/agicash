export type MeasureOperation = <T>(
  name: string,
  operation: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
) => Promise<T>;

let measurer: MeasureOperation = (_name, operation) => operation();

/**
 * Registers the host app's performance instrumentation. The web app registers
 * its Sentry-backed measurer at startup; without registration operations run
 * unmeasured (pass-through).
 */
export function setOperationMeasurer(fn: MeasureOperation): void {
  measurer = fn;
}

/**
 * Wraps an async operation with the registered instrumentation.
 * Same contract as the web's Sentry-backed measureOperation.
 */
export const measureOperation: MeasureOperation = (
  name,
  operation,
  attributes,
) => measurer(name, operation, attributes);
