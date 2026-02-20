import {
  type Encryption,
  getEncryption,
} from '@agicash/core/features/shared/encryption';
import { getPrivateKeyBytes, getPublicKey } from '@opensecret/react';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { hexToUint8Array } from '~/lib/utils';

// Re-export core types/functions for backward compatibility
export {
  type Encryption,
  getEncryption,
  encryptToPublicKey,
  encryptBatchToPublicKey,
  decryptWithPrivateKey,
  decryptBatchWithPrivateKey,
} from '@agicash/core/features/shared/encryption';

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
