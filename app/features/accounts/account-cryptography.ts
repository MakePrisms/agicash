const derivationPathIndexes: Record<string, number> = {
  cashu: 0,
  nostr: 1,
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
  accountType: keyof typeof derivationPathIndexes,
  words: 12 | 24,
) {
  const index = derivationPathIndexes[accountType];
  return `m/83696968'/39'/0'/${words}'/${index}'`;
}
