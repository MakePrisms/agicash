import { getPrivateKeyBytes, getPublicKey } from '@agicash/opensecret';
import { hexToBytes } from '@noble/hashes/utils';
import { BASE_CASHU_LOCKING_DERIVATION_PATH, getCashuSeed } from './lib/cashu';
import { deriveCashuXpub } from './lib/cryptography';
import { type Encryption, getEncryption } from './lib/encryption';
import {
  getSparkIdentityPublicKeyFromMnemonic,
  getSparkMnemonic,
} from './lib/spark/wallet';

// 10111099 is 'enc' (for encryption) in ascii
const encryptionKeyDerivationPath = `m/10111099'/0'`;

/**
 * The per-session key material the accounts and user namespaces derive from
 * Open Secret. Every getter is memoized for the life of the session and
 * cleared by {@link SessionKeys.reset}; a getter never resolves one user's key
 * into the next user's session.
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
  /** Clears every memo. Call on session end so the next user derives fresh keys. */
  reset(): void;
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
 * Memoizes an async derivation, generation-fenced so a fetch started before
 * {@link clear} cannot populate the cache afterwards — its value belongs to the
 * ended session. A rejection is not cached, so a retry can recover.
 */
function createMemo<T>(fetcher: () => Promise<T>) {
  let cached: { value: T } | undefined;
  let inFlight: Promise<T> | undefined;
  let generation = 0;

  return {
    clear: () => {
      generation += 1;
      cached = undefined;
      inFlight = undefined;
    },
    get: (): Promise<T> => {
      if (cached) {
        return Promise.resolve(cached.value);
      }
      if (!inFlight) {
        const startedGeneration = generation;
        inFlight = (async () => {
          try {
            const value = await fetcher();
            if (generation === startedGeneration) {
              cached = { value };
            }
            return value;
          } finally {
            if (generation === startedGeneration) {
              inFlight = undefined;
            }
          }
        })();
      }
      return inFlight;
    },
  };
}

const readEncryptionPrivateKey = (): Promise<Uint8Array> =>
  getPrivateKeyBytes({
    private_key_derivation_path: encryptionKeyDerivationPath,
  }).then((response) => hexToBytes(response.private_key));

const readEncryptionPublicKey = (): Promise<string> =>
  getPublicKey('schnorr', {
    private_key_derivation_path: encryptionKeyDerivationPath,
  }).then((response) => response.public_key);

export function createSessionKeys(deps: SessionKeysDeps = {}): SessionKeys {
  const encryptionPrivateKey = createMemo(
    deps.readEncryptionPrivateKey ?? readEncryptionPrivateKey,
  );
  const encryptionPublicKey = createMemo(
    deps.readEncryptionPublicKey ?? readEncryptionPublicKey,
  );
  const cashuSeed = createMemo(deps.readCashuSeed ?? getCashuSeed);
  const sparkMnemonic = createMemo(deps.readSparkMnemonic ?? getSparkMnemonic);
  const cashuLockingXpub = createMemo(async () =>
    deriveCashuXpub(await cashuSeed.get(), BASE_CASHU_LOCKING_DERIVATION_PATH),
  );
  const sparkIdentityPublicKey = createMemo(async () =>
    // FLAG(step-6 plan): master hardcodes MAINNET here (_protected.tsx TODO
    // "how to handle this network? We specify the network on the account
    // creation."); ported as-is rather than reading config.spark.network.
    getSparkIdentityPublicKeyFromMnemonic(await sparkMnemonic.get(), 'mainnet'),
  );

  return {
    getEncryption: async () =>
      getEncryption(
        await encryptionPrivateKey.get(),
        await encryptionPublicKey.get(),
      ),
    getEncryptionPublicKey: encryptionPublicKey.get,
    getCashuSeed: cashuSeed.get,
    getSparkMnemonic: sparkMnemonic.get,
    getCashuLockingXpub: cashuLockingXpub.get,
    getSparkIdentityPublicKey: sparkIdentityPublicKey.get,
    reset: () => {
      encryptionPrivateKey.clear();
      encryptionPublicKey.clear();
      cashuSeed.clear();
      sparkMnemonic.clear();
      cashuLockingXpub.clear();
      sparkIdentityPublicKey.clear();
    },
  };
}
