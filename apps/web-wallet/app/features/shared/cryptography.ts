import {
  getPrivateKey,
  getPrivateKeyBytes,
  getPublicKey,
  signMessage,
} from '@agicash/opensecret';
import { useMemo } from 'react';

// Transitional re-export — moved to @agicash/wallet-sdk; removed in the import-cleanup PR.
export { derivePublicKey } from '@agicash/wallet-sdk/cryptography';

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
