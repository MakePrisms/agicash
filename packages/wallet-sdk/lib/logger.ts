import type { Logger } from '../sdk';

const noop = () => undefined;

/** Discards all diagnostics — for hosts that want no logging. */
export const nullLogger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};
