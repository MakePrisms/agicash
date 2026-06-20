import type { StorageAdapter } from '@agicash/wallet-sdk';

/** `getStore` is invoked lazily per call so importing this module never touches
 * `window` — the module graph (and therefore `_protected.tsx`) stays import-safe
 * during SSR. The DOM is read only when a method runs, which only happens once
 * `initSdk()` is called from client middleware. */
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

/** Durable StorageAdapter backed by window.localStorage (SDK config.storage). */
export const browserLocalStorageAdapter: StorageAdapter = wrap(
  () => window.localStorage,
);

/** Ephemeral StorageAdapter backed by window.sessionStorage (SDK
 * config.sessionStorage). Survives reloads for Open Secret's enclave handshake. */
export const browserSessionStorageAdapter: StorageAdapter = wrap(
  () => window.sessionStorage,
);
