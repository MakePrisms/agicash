import {
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  getCashuSeed,
} from '../../lib/cashu';
import { deriveCashuXpub } from '../../lib/cryptography';
import {
  type Encryption,
  decryptBatchWithPrivateKey,
  decryptWithPrivateKey,
  encryptBatchToPublicKey,
  encryptToPublicKey,
  readEncryptionPrivateKey,
  readEncryptionPublicKey,
} from '../../lib/encryption';
import { DisposedError, SessionEndedError } from '../../lib/error';
import {
  getSparkIdentityPublicKeyFromMnemonic,
  getSparkMnemonic,
} from '../../lib/spark/wallet';

/**
 * The per-session key material the accounts and user namespaces derive from
 * Open Secret. Every getter is memoized for the life of the session. A getter
 * whose session ends before it resolves rejects with `SessionEndedError` rather
 * than resolving one user's key into the next user's session, so a key-dependent
 * operation rejects instead of running on a key that no longer belongs to the
 * live session; a getter reached after disposal rejects with `DisposedError`.
 */
export type SessionKeys = {
  /** ECIES encryption functions bound to the session's encryption keypair. */
  getEncryption(): Promise<Encryption>;
  /** Hex-encoded encryption public key, as persisted on the user row. */
  getEncryptionPublicKey(): Promise<string>;
  /** BIP39 master seed for Cashu wallet derivation. */
  getCashuSeed(): Promise<Uint8Array>;
  /** BIP39 mnemonic for Spark wallet derivation. */
  getSparkMnemonic(): Promise<string>;
  /** Extended public key for locking proofs and mint quotes, as persisted on the user row. */
  getCashuLockingXpub(): Promise<string>;
  /** Spark identity public key, as persisted on the user row. */
  getSparkIdentityPublicKey(): Promise<string>;
  /**
   * The current session's abort signal. It aborts on {@link SessionKeys.reset}
   * (a session end) and on disposal. A key-dependent operation captures it at
   * its start and rejects if it aborts before the operation returns, so the
   * operation rejects rather than resolving for a session that has ended.
   * Cancellation of a DB write it threads the signal into is best-effort (a
   * remote commit can still win the race); the guarantee is that no result is
   * used, and no cross-session key material, for an ended session.
   */
  sessionSignal(): AbortSignal;
  /** Clears every memo. Call on session end so the next user derives fresh keys. */
  reset(): void;
};

/** {@link SessionKeys} plus the terminal teardown the owning SDK instance holds. */
export type OwnedSessionKeys = SessionKeys & {
  /**
   * Terminal teardown, distinct from the reusable {@link SessionKeys.reset}:
   * after it every getter rejects with `DisposedError`, an already-returned
   * {@link Encryption} facade rejects, and no further derivation runs. Called on
   * SDK dispose so a capability retained across disposal can't serve a dead
   * instance's keys.
   */
  dispose(): void;
};

/**
 * Test seam. Each reader defaults to the real Open Secret derivation; tests
 * override them to assert the memo fencing without a live Open Secret.
 */
type SessionKeysDeps = {
  readEncryptionPrivateKey?: () => Promise<Uint8Array>;
  readEncryptionPublicKey?: () => Promise<string>;
  readCashuSeed?: () => Promise<Uint8Array>;
  readSparkMnemonic?: () => Promise<string>;
};

/**
 * Memoizes an async derivation for the life of a session. Every call checks the
 * current session signal before serving a cached value, so a getter reached
 * while the session is aborted — including reentrantly, from a synchronous abort
 * listener during {@link SessionKeys.reset} before the memos are cleared —
 * rejects with `SessionEndedError` instead of returning stale key material. A
 * derivation in flight when its session ends likewise rejects rather than
 * resolving to its caller; a rejection is not cached, so a retry can recover.
 * A getter reached after disposal rejects with `DisposedError`.
 */
function createMemo<T>(
  fetcher: () => Promise<T>,
  getSignal: () => AbortSignal,
  isDisposed: () => boolean,
) {
  let cached: { value: T } | undefined;
  let inFlight: Promise<T> | undefined;

  return {
    clear: () => {
      cached = undefined;
      inFlight = undefined;
    },
    get: (): Promise<T> => {
      if (isDisposed()) {
        return Promise.reject(new DisposedError());
      }
      const signal = getSignal();
      if (signal.aborted) {
        return Promise.reject(new SessionEndedError());
      }
      if (cached) {
        return Promise.resolve(cached.value);
      }
      if (!inFlight) {
        inFlight = (async () => {
          try {
            const value = await fetcher();
            if (isDisposed()) {
              throw new DisposedError();
            }
            if (signal.aborted) {
              throw new SessionEndedError();
            }
            cached = { value };
            return value;
          } finally {
            if (!signal.aborted) {
              inFlight = undefined;
            }
          }
        })();
      }
      return inFlight;
    },
  };
}

export function createSessionKeys(
  deps: SessionKeysDeps = {},
): OwnedSessionKeys {
  // Aborted on every session end (see reset) and on disposal (see dispose). A
  // derivation in flight when the session ends holds the signal it started
  // under; once that signal is aborted its result belongs to a session that no
  // longer exists and rejects rather than resolving into the next one.
  let sessionScope = new AbortController();
  let disposed = false;
  const getSignal = () => sessionScope.signal;
  const isDisposed = () => disposed;

  const encryptionPrivateKey = createMemo(
    deps.readEncryptionPrivateKey ?? readEncryptionPrivateKey,
    getSignal,
    isDisposed,
  );
  const encryptionPublicKey = createMemo(
    deps.readEncryptionPublicKey ?? readEncryptionPublicKey,
    getSignal,
    isDisposed,
  );
  const cashuSeed = createMemo(
    deps.readCashuSeed ?? getCashuSeed,
    getSignal,
    isDisposed,
  );
  const sparkMnemonic = createMemo(
    deps.readSparkMnemonic ?? getSparkMnemonic,
    getSignal,
    isDisposed,
  );
  const cashuLockingXpub = createMemo(
    async () =>
      deriveCashuXpub(
        await cashuSeed.get(),
        BASE_CASHU_LOCKING_DERIVATION_PATH,
      ),
    getSignal,
    isDisposed,
  );
  const sparkIdentityPublicKey = createMemo(
    async () =>
      // Network is fixed to mainnet here; per-account network selection is
      // not yet wired to config.spark.network.
      getSparkIdentityPublicKeyFromMnemonic(
        await sparkMnemonic.get(),
        'mainnet',
      ),
    getSignal,
    isDisposed,
  );

  const clearMemos = () => {
    encryptionPrivateKey.clear();
    encryptionPublicKey.clear();
    cashuSeed.clear();
    sparkMnemonic.clear();
    cashuLockingXpub.clear();
    sparkIdentityPublicKey.clear();
  };

  return {
    getEncryption: async () => {
      if (disposed) {
        throw new DisposedError();
      }
      // Fences on the scope the composite began under: each getter fences its
      // own derivation, but a reset landing between the two would otherwise pair
      // one session's private key with the next session's public key.
      const signal = sessionScope.signal;
      const [privateKey, publicKey] = await Promise.all([
        encryptionPrivateKey.get(),
        encryptionPublicKey.get(),
      ]);
      if (disposed) {
        throw new DisposedError();
      }
      if (signal.aborted) {
        throw new SessionEndedError();
      }
      // The returned capability is revocable: raw key bytes copied out can't be,
      // but each method on this facade rejects once its session ends or the
      // instance disposes, so a handle a host caches can't keep encrypting with a
      // dead session's keys. Explicit methods (not a Proxy) keep the Encryption
      // generic signatures intact for callers and delegate to the lib primitives.
      return {
        encrypt: async <T = unknown>(data: T) => {
          if (disposed) {
            return Promise.reject(new DisposedError());
          }
          if (signal.aborted) {
            return Promise.reject(new SessionEndedError());
          }
          return encryptToPublicKey(data, publicKey);
        },
        decrypt: async <T = unknown>(data: string) => {
          if (disposed) {
            return Promise.reject(new DisposedError());
          }
          if (signal.aborted) {
            return Promise.reject(new SessionEndedError());
          }
          return decryptWithPrivateKey<T>(data, privateKey);
        },
        encryptBatch: async <T extends readonly unknown[]>(data: T) => {
          if (disposed) {
            return Promise.reject(new DisposedError());
          }
          if (signal.aborted) {
            return Promise.reject(new SessionEndedError());
          }
          return encryptBatchToPublicKey(data, publicKey);
        },
        decryptBatch: async <T extends readonly unknown[]>(
          data: readonly [...{ [K in keyof T]: string }],
        ) => {
          if (disposed) {
            return Promise.reject(new DisposedError());
          }
          if (signal.aborted) {
            return Promise.reject(new SessionEndedError());
          }
          return decryptBatchWithPrivateKey<T>(data, privateKey);
        },
      };
    },
    getEncryptionPublicKey: encryptionPublicKey.get,
    getCashuSeed: cashuSeed.get,
    getSparkMnemonic: sparkMnemonic.get,
    getCashuLockingXpub: cashuLockingXpub.get,
    getSparkIdentityPublicKey: sparkIdentityPublicKey.get,
    sessionSignal: () => sessionScope.signal,
    reset: () => {
      // Disposal is terminal: keep the aborted signal and disposed getters
      // rather than installing a fresh scope a late onSessionEnded would revive.
      if (disposed) {
        return;
      }
      sessionScope.abort();
      sessionScope = new AbortController();
      clearMemos();
    },
    dispose: () => {
      disposed = true;
      sessionScope.abort();
      clearMemos();
    },
  };
}
