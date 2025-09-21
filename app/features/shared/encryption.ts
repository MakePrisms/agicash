import { getPrivateKeyBytes, getPublicKey } from '@opensecret/react';
import { decode, encode } from '@stablelib/base64';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { eciesDecrypt, eciesEncrypt } from '~/lib/ecies';
import { Money } from '~/lib/money';
import { hexToUint8Array } from '~/lib/utils';

// 10111099 is 'enc' (for encryption) in ascii
const encryptionKeyDerivationPath = `m/10111099'/0'`;

export const encryptionPrivateKeyQueryOptions = () =>
  queryOptions({
    queryKey: ['encryption-private-key'],
    queryFn: () =>
      getPrivateKeyBytes({
        private_key_derivation_path: encryptionKeyDerivationPath,
      }).then((response) => hexToUint8Array(response.private_key)),
    staleTime: Number.POSITIVE_INFINITY,
  });

export const useEncryptionPrivateKey = () => {
  const { data } = useSuspenseQuery(encryptionPrivateKeyQueryOptions());
  return data;
};

export const encryptionPublicKeyQueryOptions = () =>
  queryOptions({
    queryKey: ['encryption-public-key'],
    queryFn: () =>
      getPublicKey('schnorr', {
        private_key_derivation_path: encryptionKeyDerivationPath,
      }).then((response) => response.public_key),
    staleTime: Number.POSITIVE_INFINITY,
  });

export const useEncryptionPublicKeyHex = () => {
  const { data } = useSuspenseQuery(encryptionPublicKeyQueryOptions());
  return data;
};

/**
 * This function preprocesses the data to preserve the type information for dates.
 * This is needed before serializing the data to a string because JSON.stringify replaces Date with string before replacer function is called.
 */
function preprocessData(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;

  if (obj instanceof Date) {
    return { __type: 'Date', value: obj.toISOString() };
  }

  if (Array.isArray(obj)) {
    return obj.map(preprocessData);
  }

  if (obj instanceof Money) {
    return { __type: 'Money', amount: obj.amount(), currency: obj.currency };
  }

  const result: Record<string, unknown> = {};
  for (const key in obj) {
    result[key] = preprocessData(obj[key as keyof typeof obj]);
  }
  return result;
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
  const preprocessedData = preprocessData(data);
  const serialized = JSON.stringify(preprocessedData, (_, value) => {
    if (value === undefined) {
      return { __type: 'undefined' };
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return { __type: 'number', value: value.toString() };
    }
    return value;
  });

  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(serialized);
  const publicKeyBytes = hexToUint8Array(publicKeyHex);

  const encryptedBytes = eciesEncrypt(dataBytes, publicKeyBytes);
  return encode(encryptedBytes);
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

  return JSON.parse(decryptedString, (_, value) => {
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
          });
      }
    }
    return value;
  }) as T;
}

type Encryption = {
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
  };
};

/**
 * Hook that provides the encryption functions.
 * Reference of the returned data is stable and doesn't change between renders.
 * Technical details:
 * - Encrypts data with ECIES using ChaCha20-Poly1305
 * - A random ephemeral key is generated for each encryption operation
 * - The encrypted data format is base64-encoded
 * @returns The encryption functions.
 */
export const useEncryption = (): Encryption => {
  const privateKey = useEncryptionPrivateKey();
  const publicKeyHex = useEncryptionPublicKeyHex();

  return useMemo(
    () => getEncryption(privateKey, publicKeyHex),
    [privateKey, publicKeyHex],
  );
};
