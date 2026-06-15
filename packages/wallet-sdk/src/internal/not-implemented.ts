import { NotImplementedError } from '../errors';

/**
 * A typed stand-in for a domain interface whose every method throws
 * {@link NotImplementedError}. Used to stub domains until their slice lands.
 * `then`/symbol access returns undefined so the stub is never treated as a
 * thenable or mangled by inspection.
 */
export function notImplementedDomain<T extends object>(domain: string): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      return () => {
        throw new NotImplementedError(`${domain}.${String(prop)}()`);
      };
    },
  });
}
