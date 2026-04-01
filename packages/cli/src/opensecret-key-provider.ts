import {
  getPrivateKey,
  getPrivateKeyBytes,
  getPublicKey,
} from '@agicash/opensecret-sdk';
import type { KeyProvider } from '@agicash/sdk/interfaces/key-provider';

/**
 * Creates a KeyProvider backed by the OpenSecret SDK.
 *
 * Each method delegates to the corresponding SDK function, which handles
 * BIP-85 / BIP-32 derivation server-side using the user's stored seed.
 */
export function createOpenSecretKeyProvider(): KeyProvider {
  return {
    async getPrivateKeyBytes(params) {
      return getPrivateKeyBytes(params);
    },

    async getPublicKey(type, params) {
      return getPublicKey(type, params);
    },

    async getMnemonic(params) {
      return getPrivateKey(params);
    },
  };
}
