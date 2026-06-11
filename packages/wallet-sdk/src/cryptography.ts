import { HDKey } from '@scure/bip32';

/**
 * Derives the public key at the derivation path from the extended public key.
 * @returns The derived public key as a hex string, or '' when the child has
 * no public key.
 */
export const derivePublicKey = (xpub: string, derivationPath: string) => {
  const hdKey = HDKey.fromExtendedKey(xpub);
  const childKey = hdKey.derive(derivationPath);
  return childKey.publicKey
    ? Array.from(childKey.publicKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    : '';
};
