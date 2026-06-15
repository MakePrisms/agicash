import type { StorageAdapter } from '../src/config';

/** `getStore` is invoked lazily per call so that importing this module never
 * touches `window` — the SDK barrel can be imported headlessly (bun/node) with
 * no ReferenceError; the DOM is read only when a method actually runs, which
 * only happens in a browser host. */
const wrap = (getStore: () => Storage): StorageAdapter => ({
  get: (key) => Promise.resolve(getStore().getItem(key) ?? undefined),
  set: (key, value) => {
    getStore().setItem(key, value);
    return Promise.resolve();
  },
  remove: (key) => {
    getStore().removeItem(key);
    return Promise.resolve();
  },
});

/** Durable StorageAdapter backed by window.localStorage (web host -> config.storage). */
export const browserStorageAdapter: StorageAdapter = wrap(
  () => window.localStorage,
);

/** Ephemeral StorageAdapter backed by window.sessionStorage (web host ->
 * config.sessionStorage). Keeps the enclave handshake alive across reloads. */
export const browserSessionStorageAdapter: StorageAdapter = wrap(
  () => window.sessionStorage,
);
