import { getPrivateKeyBytes, getPublicKey } from '@agicash/opensecret';
import {
  type Encryption,
  getEncryption,
} from '@agicash/sdk/features/shared/encryption';
import { hexToBytes } from '@noble/hashes/utils';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

// Re-export all pure SDK functions and types
export {
  type Encryption,
  getEncryption,
  encryptToPublicKey,
  encryptBatchToPublicKey,
  decryptWithPrivateKey,
  decryptBatchWithPrivateKey,
  preprocessData,
  serializeData,
  deserializeData,
} from '@agicash/sdk/features/shared/encryption';

// 10111099 is 'enc' (for encryption) in ascii
const encryptionKeyDerivationPath = `m/10111099'/0'`;

export const encryptionPrivateKeyQueryOptions = () =>
  queryOptions({
    queryKey: ['encryption-private-key'],
    queryFn: () =>
      getPrivateKeyBytes({
        private_key_derivation_path: encryptionKeyDerivationPath,
      }).then((response) => hexToBytes(response.private_key)),
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
