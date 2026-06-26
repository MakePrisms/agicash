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

const derivationPathIndexes: Record<string, number> = {
  cashu: 0,
  spark: 1,
};

/**
 * Get the derivation path for a given account type based on the BIP-85 standard
 * in the format `m/83696968'/39'/0'/${words}'/${index}'`
 * - `83696968` defines the purpose and is 'SEED' in ascii.
 * - `39` denotes the application is BIP-39 (mnemonic seed words)
 * - `0` denotes the language of the seed words is English
 * - `words` denotes the number of words in the seed phrase (12 or 24)
 * - `index` denotes the index for unique seed phrases
 */
export function getSeedPhraseDerivationPath(
  accountType: 'cashu' | 'spark',
  words: 12 | 24,
) {
  const index = derivationPathIndexes[accountType];
  return `m/83696968'/39'/0'/${words}'/${index}'`;
}
