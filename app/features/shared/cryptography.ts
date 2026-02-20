import {
  getPrivateKey,
  getPrivateKeyBytes,
  getPublicKey,
  signMessage,
} from '@opensecret/react';
import { useMemo } from 'react';

// Re-export core function for backward compatibility
export { derivePublicKey } from '@agicash/core/features/shared/cryptography';

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
