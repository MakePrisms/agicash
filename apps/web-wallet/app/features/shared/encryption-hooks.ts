import type { Encryption } from '@agicash/wallet-sdk/temporary';
import {
  getEncryption,
  readEncryptionPrivateKey,
  readEncryptionPublicKey,
} from '@agicash/wallet-sdk/temporary';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';

export const encryptionQueryOptions = () =>
  queryOptions({
    queryKey: ['encryption'],
    // Derives then wraps in one step so the raw private-key bytes are never
    // stored in the query cache — only the encrypt/decrypt closures are.
    queryFn: async () =>
      getEncryption(
        await readEncryptionPrivateKey(),
        await readEncryptionPublicKey(),
      ),
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
