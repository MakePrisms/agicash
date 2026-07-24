import type { Encryption } from '@agicash/wallet-sdk/temporary';
import {
  decryptBatchWithPrivateKey,
  decryptWithPrivateKey,
  encryptBatchToPublicKey,
  encryptToPublicKey,
  readEncryptionPrivateKey,
  readEncryptionPublicKey,
} from '@agicash/wallet-sdk/temporary';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';

export const encryptionQueryOptions = () =>
  queryOptions({
    queryKey: ['encryption'],
    // Derives then wraps so the raw private-key bytes are never stored in the
    // query cache — only the encrypt/decrypt closures that capture them are.
    // TEMPORARY: duplicates the SDK session-key facade's construction
    // (packages/wallet-sdk/domain/sdk/session-keys.ts builds the same object
    // literal from these primitives). Deleted at step 18 when receive/send/claim
    // migrate into the SDK and this query is removed.
    queryFn: async (): Promise<Encryption> => {
      const privateKey = await readEncryptionPrivateKey();
      const publicKeyHex = await readEncryptionPublicKey();
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
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

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
  const { data } = useSuspenseQuery(encryptionQueryOptions());
  return data;
};
