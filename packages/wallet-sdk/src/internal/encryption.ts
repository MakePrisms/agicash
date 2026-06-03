/**
 * Internal ECIES encryption — Slice 3 (cashu + spark).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/shared/encryption.ts`. A cashu account's stored proofs are
 * encrypted to the user's data-encryption key; reading an account therefore DECRYPTS the
 * `amount` + `secret` ciphertext (master `account-repository.decryptCashuProofs` →
 * `encryption.decryptBatch`), and the send/receive services that persist new quotes/swaps/
 * proofs (PR5b) ENCRYPT their `*-db-data` JSON + change proofs (`encrypt`/`encryptBatch`).
 * Master expresses `Encryption` as a React hook (`useEncryption`) over two
 * `@tanstack/react-query` suspense queries that fetch the derived private key + public key
 * from the OpenSecret enclave; here the same key-derivation + ECIES is plain async code.
 *
 * The full encrypt+decrypt surface is built (PR5a shipped the decrypt half for the account
 * read path; PR5b adds the encrypt half the write path needs). The
 * `preprocessData`/`serializeData`/`deserializeData` type-preservation (Date / undefined /
 * non-finite number / `Money`) is ported VERBATIM from master so a value round-trips
 * identically across encrypt → DB → decrypt — for a proof, `amount` deserialises to a
 * `number` and `secret` to a `string`.
 *
 * KEYS: ECIES decrypt uses the user's 32-byte data-encryption PRIVATE key; encrypt uses the
 * corresponding PUBLIC key (master `getPublicKey('schnorr', …)`). Both are derived from the
 * OpenSecret enclave at `m/10111099'/0'` (`'enc'` in ASCII) and are stable for the session
 * (master caches both with `staleTime: Infinity`).
 *
 * @module
 */
import { hexToBytes } from '@noble/hashes/utils';
import { decode, encode } from '@stablelib/base64';
import {
  eciesDecrypt,
  eciesDecryptBatch,
  eciesEncrypt,
  eciesEncryptBatch,
} from './lib-ecies';
import { Money } from '../types/money';

/**
 * Master's `preprocessData`: tag `Date` / `undefined` / non-finite `number` so JSON can
 * round-trip them; `Money` is left as-is (re-tagged on serialize via its own JSON form).
 * Ported verbatim from `shared/encryption.ts#preprocessData`.
 */
function preprocessData(obj: unknown): unknown {
  if (obj === undefined) {
    return { __type: 'undefined' };
  }

  if (typeof obj === 'number' && !Number.isFinite(obj)) {
    return { __type: 'number', value: obj.toString() };
  }

  if (obj === null || typeof obj !== 'object' || obj instanceof Money) {
    return obj;
  }

  if (obj instanceof Date) {
    return { __type: 'Date', value: obj.toISOString() };
  }

  if (Array.isArray(obj)) {
    return obj.map(preprocessData);
  }

  const result: Record<string, unknown> = {};
  for (const key in obj) {
    result[key] = preprocessData(obj[key as keyof typeof obj]);
  }
  return result;
}

/** Master's `serializeData`: `preprocessData` + `JSON.stringify`. */
function serializeData(data: unknown): string {
  const preprocessedData = preprocessData(data);
  return JSON.stringify(preprocessedData);
}

/**
 * Reverse of master's `preprocessData`: rehydrate the type-tagged JSON back into `Date` /
 * `undefined` / non-finite `number` / `Money`. A JSON `reviver`, ported verbatim from
 * `shared/encryption.ts#deserializeData` so a value encrypted by master decrypts identically.
 *
 * @param serializedData - the decrypted JSON string.
 * @returns the rehydrated value.
 */
function deserializeData<T = unknown>(serializedData: string): T {
  return JSON.parse(serializedData, (_, value) => {
    if (value && typeof value === 'object' && '__type' in value) {
      switch (value.__type) {
        case 'Date':
          return new Date(value.value);
        case 'undefined':
          return undefined;
        case 'number':
          return Number(value.value); // handles Infinity, -Infinity, NaN
        case 'Money':
          return new Money({
            amount: value.amount,
            currency: value.currency,
            unit: value.unit,
          });
      }
    }
    return value;
  }) as T;
}

/**
 * Encrypt one value to the user's data-encryption public key with ECIES, base64-encoded.
 * Ported from `shared/encryption.ts#encryptToPublicKey`.
 */
function encryptToPublicKey<T = unknown>(
  data: T,
  publicKeyHex: string,
): string {
  const serialized = serializeData(data);
  const dataBytes = new TextEncoder().encode(serialized);
  const publicKeyBytes = hexToBytes(publicKeyHex);
  return encode(eciesEncrypt(dataBytes, publicKeyBytes));
}

/**
 * Encrypt a batch of values to the user's data-encryption public key (one shared ephemeral
 * key for the batch). Order preserved. Ported from `shared/encryption.ts#encryptBatchToPublicKey`.
 */
function encryptBatchToPublicKey<T extends readonly unknown[]>(
  data: T,
  publicKeyHex: string,
): string[] {
  const encoder = new TextEncoder();
  const dataBytes = data.map((x) =>
    encoder.encode(JSON.stringify(preprocessData(x))),
  );
  const publicKeyBytes = hexToBytes(publicKeyHex);
  return eciesEncryptBatch(dataBytes, publicKeyBytes).map((x) => encode(x));
}

/**
 * Decrypt one base64-encoded ECIES ciphertext with the user's private key. Ported from
 * `shared/encryption.ts#decryptWithPrivateKey`.
 */
function decryptWithPrivateKey<T = unknown>(
  encryptedData: string,
  privateKeyBytes: Uint8Array,
): T {
  const decryptedBytes = eciesDecrypt(decode(encryptedData), privateKeyBytes);
  const decryptedString = new TextDecoder().decode(decryptedBytes);
  return deserializeData<T>(decryptedString);
}

/**
 * Decrypt a batch of base64-encoded ECIES ciphertexts with the user's private key, order
 * preserved. Ported from `shared/encryption.ts#decryptBatchWithPrivateKey`.
 *
 * @param encryptedDataArray - the base64 ciphertexts (one per input).
 * @param privateKeyBytes - the 32-byte data-encryption private key.
 * @returns the decrypted values, in input order.
 */
function decryptBatchWithPrivateKey<T extends readonly unknown[]>(
  encryptedDataArray: readonly [...{ [K in keyof T]: string }],
  privateKeyBytes: Uint8Array,
): T {
  const decodedData = encryptedDataArray.map((x) => decode(x));
  const decryptedData = eciesDecryptBatch(decodedData, privateKeyBytes);
  const decoder = new TextDecoder();
  return decryptedData.map((x) => {
    const decodedString = decoder.decode(x);
    return deserializeData(decodedString);
  }) as unknown as T;
}

/**
 * The encrypt + decrypt surface the account read path + the send/receive write path need —
 * the framework-free form of master's `Encryption` type.
 */
export type Encryption = {
  /** Encrypt one value to the user's data-encryption public key (base64 ECIES). */
  encrypt: <T = unknown>(data: T) => Promise<string>;
  /** Decrypt one value previously encrypted with `encrypt`. */
  decrypt: <T = unknown>(data: string) => Promise<T>;
  /**
   * Encrypt an array of values to the user's data-encryption public key (one shared ephemeral
   * key for the batch). Order preserved.
   */
  encryptBatch: <T extends readonly unknown[]>(data: T) => Promise<string[]>;
  /**
   * Decrypt an array of values previously encrypted with `encryptBatch` (or any user-key
   * ciphertexts). Input may be in any order; output order matches input.
   *
   * @param data - base64-encoded ECIES ciphertexts.
   * @returns a promise of the decrypted values, in input order.
   */
  decryptBatch: <T extends readonly unknown[]>(
    data: readonly [...{ [K in keyof T]: string }],
  ) => Promise<T>;
};

/**
 * Build an {@link Encryption} bound to the user's data-encryption private + public keys.
 * Ported from `shared/encryption.ts#getEncryption`. The keys are the 32-byte private key +
 * its hex public key the SDK derives from the OpenSecret enclave (see {@link createEncryption}).
 *
 * @param privateKey - the 32-byte data-encryption private key (decrypt).
 * @param publicKeyHex - the hex-encoded data-encryption public key (encrypt).
 * @returns the encryption surface.
 */
export function getEncryption(
  privateKey: Uint8Array,
  publicKeyHex: string,
): Encryption {
  return {
    encrypt: async <T = unknown>(data: T) =>
      encryptToPublicKey(data, publicKeyHex),
    decrypt: async <T = unknown>(data: string) =>
      decryptWithPrivateKey<T>(data, privateKey),
    encryptBatch: async <T extends readonly unknown[]>(data: T) =>
      encryptBatchToPublicKey(data, publicKeyHex),
    decryptBatch: async <T extends readonly unknown[]>(
      data: readonly [...{ [K in keyof T]: string }],
    ) => decryptBatchWithPrivateKey<T>(data, privateKey),
  };
}

/**
 * Fetch the user's hex-encoded data-encryption private key from the enclave. Injected
 * (rather than importing `@agicash/opensecret` here) so this module stays a pure mechanism
 * the SDK wires to OpenSecret's `getPrivateKeyBytes` — and so it is trivially testable
 * without a live enclave.
 *
 * Master derives this key at `m/10111099'/0'` (`'enc'` in ASCII) via
 * `getPrivateKeyBytes({ private_key_derivation_path })` and `hexToBytes`-decodes the result
 * (`shared/encryption.ts#encryptionPrivateKeyQueryOptions`).
 */
export type FetchEncryptionPrivateKeyHex = () => Promise<string>;

/**
 * Fetch the user's hex-encoded data-encryption PUBLIC key from the enclave. Injected for the
 * same reason as {@link FetchEncryptionPrivateKeyHex}. Master derives it at the same
 * `m/10111099'/0'` path via `getPublicKey('schnorr', …)`
 * (`shared/encryption.ts#encryptionPublicKeyQueryOptions`).
 */
export type FetchEncryptionPublicKeyHex = () => Promise<string>;

/**
 * Construct an {@link Encryption} from the enclave key fetchers, lazily fetching + caching
 * the derived private + public keys on first use (both are stable for the session — master
 * caches them with `staleTime: Infinity`). Concurrent first-callers share the single
 * in-flight fetch.
 *
 * @param fetchPrivateKeyHex - obtains the hex-encoded data-encryption private key (decrypt).
 * @param fetchPublicKeyHex - obtains the hex-encoded data-encryption public key (encrypt).
 * @returns an {@link Encryption} whose methods resolve the keys on first call.
 */
export function createEncryption(
  fetchPrivateKeyHex: FetchEncryptionPrivateKeyHex,
  fetchPublicKeyHex: FetchEncryptionPublicKeyHex,
): Encryption {
  let keysPromise: Promise<{
    privateKey: Uint8Array;
    publicKeyHex: string;
  }> | null = null;
  const getKeys = (): Promise<{
    privateKey: Uint8Array;
    publicKeyHex: string;
  }> => {
    keysPromise ??= Promise.all([
      fetchPrivateKeyHex().then(hexToBytes),
      fetchPublicKeyHex(),
    ]).then(([privateKey, publicKeyHex]) => ({ privateKey, publicKeyHex }));
    return keysPromise;
  };
  const resolved = async (): Promise<Encryption> => {
    const { privateKey, publicKeyHex } = await getKeys();
    return getEncryption(privateKey, publicKeyHex);
  };
  return {
    encrypt: async <T = unknown>(data: T) => (await resolved()).encrypt(data),
    decrypt: async <T = unknown>(data: string) =>
      (await resolved()).decrypt<T>(data),
    encryptBatch: async <T extends readonly unknown[]>(data: T) =>
      (await resolved()).encryptBatch(data),
    decryptBatch: async <T extends readonly unknown[]>(
      data: readonly [...{ [K in keyof T]: string }],
    ) => (await resolved()).decryptBatch<T>(data),
  };
}
