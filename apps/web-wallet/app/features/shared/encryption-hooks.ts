import type { Encryption } from '@agicash/wallet-sdk/temporary';
import { getInternalSessionKeys } from '@agicash/wallet-sdk/temporary';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';

export const encryptionQueryOptions = () =>
  queryOptions({
    queryKey: ['encryption'],
    queryFn: () => getInternalSessionKeys().getEncryption(),
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
