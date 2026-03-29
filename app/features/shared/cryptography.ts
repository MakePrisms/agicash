import {
  getPrivateKey,
  getPrivateKeyBytes,
  getPublicKey,
  signMessage,
} from '@agicash/opensecret';
import { useMemo } from 'react';

// Re-export pure SDK functions
export { derivePublicKey } from '@agicash/sdk/features/shared/cryptography';

/**
 * Hook that provides the OpenSecret cryptography functions.
 * Reference of the returned data is stable and doesn't change between renders.
 * @returns The OpenSecret cryptography functions.
 */
export const useCryptography = () => {
  return useMemo(() => {
    return {
      getMnemonic: getPrivateKey,
      signMessage,
      getPublicKey,
      getPrivateKeyBytes,
    };
  }, []);
};
