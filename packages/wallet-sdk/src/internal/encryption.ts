/**
 * Internal ECIES encryption — Slice 3 (cashu + spark).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/shared/encryption.ts`. A cashu account's stored proofs are
 * encrypted to the user's data-encryption key; reading an account therefore DECRYPTS the
 * `amount` + `secret` ciphertext (master `account-repository.decryptCashuProofs` →
 * `encryption.decryptBatch`). Master expresses `Encryption` as a React hook
 * (`useEncryption`) over two `@tanstack/react-query` suspense queries that fetch the
 * derived key from the OpenSecret enclave; here the same key-derivation + ECIES is plain
 * async code.
 *
 * Only the DECRYPT path is built (Slice 3 reads encrypted proofs; the write/encrypt halves
 * land with the send/receive services that persist new proofs). The
 * `preprocessData`/`deserializeData` type-preservation (Date / undefined / non-finite
 * number / `Money`) is ported VERBATIM from master so a decrypted value round-trips
 * identically — for a proof, `amount` deserialises to a `number` and `secret` to a `string`.
 *
 * @module
 */
import { hexToBytes } from '@noble/hashes/utils';
import { decode } from '@stablelib/base64';
import { eciesDecryptBatch } from './lib-ecies';
import { Money } from '../types/money';

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
 * The decrypt surface the account read path needs — the framework-free half of master's
 * `Encryption` type (the encrypt/encryptBatch halves land with the slices that write
 * encrypted rows).
 */
export type Encryption = {
  /**
   * Decrypt an array of values previously encrypted with the user's encryption key. Input
   * may be in any order; output order matches input.
   *
   * @param data - base64-encoded ECIES ciphertexts.
   * @returns a promise of the decrypted values, in input order.
   */
  decryptBatch: <T extends readonly unknown[]>(
    data: readonly [...{ [K in keyof T]: string }],
  ) => Promise<T>;
};

/**
 * Build an {@link Encryption} bound to the user's data-encryption private key. Ported from
 * `shared/encryption.ts#getEncryption` (decrypt half). The key is the 32-byte private key
 * the SDK derives from the OpenSecret enclave (see {@link createEncryption}).
 *
 * @param privateKey - the 32-byte data-encryption private key.
 * @returns the encryption (decrypt) surface.
 */
export function getEncryption(privateKey: Uint8Array): Encryption {
  return {
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
 * Construct an {@link Encryption} from an enclave key fetcher, lazily fetching + caching the
 * derived private key on first use (the key is stable for the session — master caches it
 * with `staleTime: Infinity`). Concurrent first-callers share the single in-flight fetch.
 *
 * @param fetchPrivateKeyHex - obtains the hex-encoded data-encryption private key.
 * @returns an {@link Encryption} whose `decryptBatch` resolves the key on first call.
 */
export function createEncryption(
  fetchPrivateKeyHex: FetchEncryptionPrivateKeyHex,
): Encryption {
  let keyPromise: Promise<Uint8Array> | null = null;
  const getKey = (): Promise<Uint8Array> => {
    keyPromise ??= fetchPrivateKeyHex().then(hexToBytes);
    return keyPromise;
  };
  return {
    decryptBatch: async <T extends readonly unknown[]>(
      data: readonly [...{ [K in keyof T]: string }],
    ) => getEncryption(await getKey()).decryptBatch<T>(data),
  };
}
