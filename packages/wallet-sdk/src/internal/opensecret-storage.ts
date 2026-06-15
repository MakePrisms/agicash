import type { KeyValueStore, StorageProvider } from '@agicash/opensecret';
import type { StorageAdapter } from '../config';

/**
 * Bridges the SDK's async StorageAdapter(s) to Open Secret's StorageProvider:
 * - `persistent` -> `persistent` adapter (durable auth tokens), undefined->null.
 * - `session` -> `sessionAdapter` if provided (web: window.sessionStorage, so the
 *   enclave handshake survives reloads), else an SDK-owned in-memory store.
 * `clearSession()` removes every key written through the session scope (used by
 * signOut + dispose); async because a host adapter may be async.
 */
export function createOpenSecretStorage(
  persistent: StorageAdapter,
  sessionAdapter?: StorageAdapter,
): StorageProvider & { clearSession(): Promise<void> } {
  const sessionKeys = new Set<string>();
  const memory = new Map<string, string>();

  const session: KeyValueStore = sessionAdapter
    ? {
        getItem: (key) => sessionAdapter.get(key).then((v) => v ?? null),
        setItem: (key, value) => {
          sessionKeys.add(key);
          return sessionAdapter.set(key, value);
        },
        removeItem: (key) => {
          sessionKeys.delete(key);
          return sessionAdapter.remove(key);
        },
      }
    : {
        getItem: (key) => memory.get(key) ?? null,
        setItem: (key, value) => {
          sessionKeys.add(key);
          memory.set(key, value);
        },
        removeItem: (key) => {
          sessionKeys.delete(key);
          memory.delete(key);
        },
      };

  return {
    persistent: {
      getItem: (key) => persistent.get(key).then((v) => v ?? null),
      setItem: (key, value) => persistent.set(key, value),
      removeItem: (key) => persistent.remove(key),
    },
    session,
    clearSession: async () => {
      for (const key of [...sessionKeys]) {
        if (sessionAdapter) await sessionAdapter.remove(key);
      }
      sessionKeys.clear();
      memory.clear();
    },
  };
}
