export type CaptureException = (
  error: unknown,
  context?: Record<string, unknown>,
) => void;

let reporter: CaptureException = () => undefined;

/**
 * Registers the host app's error reporting. The web app registers Sentry's
 * captureException at startup; without registration captured errors are
 * silently dropped (the operations that report them handle the error
 * themselves — reporting is observability, not control flow).
 */
export function setErrorReporter(fn: CaptureException): void {
  reporter = fn;
}

/**
 * Reports an exception through the registered reporter.
 */
export const captureException: CaptureException = (error, context) =>
  reporter(error, context);
