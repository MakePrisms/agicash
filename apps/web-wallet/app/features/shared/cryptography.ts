import { HDKey } from '@scure/bip32';

/**
 * Derives a public key from an xpub and a derivation path.
 * @param xpub - The base58-check encoded xpub.
 * @param derivationPath - The derivation path to derive the public key from.
 * @returns The derived public key as a hex string.
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
