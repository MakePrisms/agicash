import type { StorageAdapter } from '../src/config';

/** In-memory StorageAdapter for tests and ephemeral headless runs. */
export function inMemoryStorageAdapter(
  seed?: Record<string, string>,
): StorageAdapter {
  const store = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    get: (key) => Promise.resolve(store.get(key)),
    set: (key, value) => {
      store.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      store.delete(key);
      return Promise.resolve();
    },
  };
}
