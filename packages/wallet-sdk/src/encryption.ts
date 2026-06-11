import { getPrivateKeyBytes, getPublicKey } from '@agicash/opensecret';
import {
  eciesDecrypt,
  eciesDecryptBatch,
  eciesEncrypt,
  eciesEncryptBatch,
} from '@agicash/utils/ecies';
import { Money } from '@agicash/utils/money';
import { hexToBytes } from '@noble/hashes/utils';
import { decode, encode } from '@stablelib/base64';
import type { QueryClient } from '@tanstack/query-core';

// 10111099 is 'enc' (for encryption) in ascii
const encryptionKeyDerivationPath = `m/10111099'/0'`;

export const encryptionPrivateKeyQueryOptions = () => ({
  queryKey: ['encryption-private-key'],
  queryFn: () =>
    getPrivateKeyBytes({
      private_key_derivation_path: encryptionKeyDerivationPath,
    }).then((response) => hexToBytes(response.private_key)),
  staleTime: Number.POSITIVE_INFINITY,
});

export const encryptionPublicKeyQueryOptions = () => ({
  queryKey: ['encryption-public-key'],
  queryFn: () =>
    getPublicKey('schnorr', {
      private_key_derivation_path: encryptionKeyDerivationPath,
    }).then((response) => response.public_key),
  staleTime: Number.POSITIVE_INFINITY,
});

/**
 * This function preprocesses the data to preserve the type information for dates, undefined, and non-finite numbers.
 * This is needed before serializing the data to a string because JSON.stringify replaces Date with string before replacer function is called.
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

function serializeData(data: unknown): string {
  const preprocessedData = preprocessData(data);
  return JSON.stringify(preprocessedData);
}

function deserializeData<T = unknown>(serializedData: string): T {
  return JSON.parse(serializedData, (_, value) => {
    if (value && typeof value === 'object' && '__type' in value) {
      switch (value.__type) {
        case 'Date':
          return new Date(value.value);
        case 'undefined':
          return undefined;
        case 'number':
          return Number(value.value); // This handles Infinity, -Infinity, NaN
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
 * Encrypt data to a public key using ECIES
 * @param data - Data to encrypt
 * @param publicKeyHex - Hex string of the public key (32 or 33 bytes)
 * @returns Base64-encoded encrypted data
 */
export function encryptToPublicKey<T = unknown>(
  data: T,
  publicKeyHex: string,
): string {
  const serialized = serializeData(data);

  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(serialized);
  const publicKeyBytes = hexToBytes(publicKeyHex);

  const encryptedBytes = eciesEncrypt(dataBytes, publicKeyBytes);
  return encode(encryptedBytes);
}

/**
 * Encrypt a batch of data to a public key using ECIES
 * The entire batch uses the same ephemeral key for faster encryption.
 * @param data - Data to encrypt
 * @param publicKeyHex - Hex string of the public key (32 or 33 bytes)
 * @returns Array of base64-encoded encrypted data. Order is preserved.
 */
export function encryptBatchToPublicKey<T extends readonly unknown[]>(
  data: T,
  publicKeyHex: string,
): string[] {
  const encoder = new TextEncoder();
  const dataBytes = data.map((x) => {
    const preprocessedData = preprocessData(x);
    const serialized = JSON.stringify(preprocessedData);
    return encoder.encode(serialized);
  });
  const publicKeyBytes = hexToBytes(publicKeyHex);

  const encryptedBytes = eciesEncryptBatch(dataBytes, publicKeyBytes);
  return encryptedBytes.map((x) => encode(x));
}

/**
 * Decrypt data with a private key using ECIES
 * @param encryptedData - Base64-encoded encrypted data
 * @param privateKeyBytes - 32-byte private key
 * @returns Decrypted data
 */
export function decryptWithPrivateKey<T = unknown>(
  encryptedData: string,
  privateKeyBytes: Uint8Array,
): T {
  const encryptedBytes = decode(encryptedData);
  const decryptedBytes = eciesDecrypt(encryptedBytes, privateKeyBytes);

  const decoder = new TextDecoder();
  const decryptedString = decoder.decode(decryptedBytes);

  return deserializeData<T>(decryptedString);
}

/**
 * Decrypt a batch of data with a private key using ECIES
 * @param encryptedDataArray - Array of base64-encoded encrypted data
 * @param privateKeyBytes - 32-byte private key
 * @returns Decrypted data in the same order as the input
 */
export function decryptBatchWithPrivateKey<T extends readonly unknown[]>(
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

export type Encryption = {
  /**
   * Encrypts arbitrary data object using ECIES to the user's data encryption public key
   * @param data - Data to be encrypted
   * @returns A promise resolving to the encrypted base64 encoded ephemeral public key, nonce, and data
   *
   * @description
   * Encrypts data with ECIES using ChaCha20-Poly1305. A random ephemeral key is generated for each encryption operation and
   * the ephemeral public key is included in the result.
   */
  encrypt: <T = unknown>(data: T) => Promise<string>;
  /**
   * Decrypts data that was previously encrypted with the user's encryption key (using 'encrypt' method)
   * @param data - Base64-encoded encrypted data string
   * @returns A promise resolving to the decrypted data
   *
   * @description
   * Decrypts the data by decoding the base64 encoded string, extracting ephemeral public key and nonce,
   * and then decrypting the data with the nonce and the user's encryption key using ECIES.
   */
  decrypt: <T = unknown>(data: string) => Promise<T>;
  /**
   * Encrypts an array of data objects using ECIES to the user's data encryption public key.
   * The entire batch uses the same ephemeral key, so the encrypted data from the same batch is linkable.
   * @param data - Array of data to be encrypted
   * @returns A promise resolving to an array of encrypted base64 encoded ephemeral public keys, nonces, and data
   */
  encryptBatch: <T extends readonly unknown[]>(data: T) => Promise<string[]>;
  /**
   * Decrypts an array of data objects that were previously encrypted with the user's encryption key (using 'encryptBatch' method).
   * The messages can be in any order - order is preserved in output.
   * @param data - Array of encrypted base64 encoded ephemeral public keys, nonces, and data
   * @returns A promise resolving to the decrypted data in the same order as the input
   */
  decryptBatch: <T extends readonly unknown[]>(
    data: readonly [...{ [K in keyof T]: string }],
  ) => Promise<T>;
};

export const getEncryption = (
  privateKey: Uint8Array,
  publicKeyHex: string,
): Encryption => {
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
};

/**
 * An Encryption whose keys are resolved lazily through the SDK's key
 * queryOptions (staleTime Infinity — one fetch, then cached). This lets the
 * Sdk root construct domains before login/key-availability; the first
 * encrypt/decrypt awaits the keys.
 */
export function createLazyEncryption(queryClient: QueryClient): Encryption {
  const resolve = async () => {
    const [privateKey, publicKeyHex] = await Promise.all([
      queryClient.fetchQuery(encryptionPrivateKeyQueryOptions()),
      queryClient.fetchQuery(encryptionPublicKeyQueryOptions()),
    ]);
    return getEncryption(privateKey, publicKeyHex);
  };

  return {
    encrypt: async (data) => (await resolve()).encrypt(data),
    decrypt: async (data) => (await resolve()).decrypt(data),
    encryptBatch: async (data) => (await resolve()).encryptBatch(data),
    decryptBatch: async (data) => (await resolve()).decryptBatch(data),
  };
}
