/** BIP-85 child-mnemonic paths (derived server-side in the OpenSecret enclave). */
export const CASHU_MNEMONIC_PATH = "m/83696968'/39'/0'/12'/0'";
export const SPARK_MNEMONIC_PATH = "m/83696968'/39'/0'/12'/1'";
/** BIP-32 encryption-key derivation path. */
export const ENCRYPTION_KEY_PATH = "m/10111099'/0'";

/**
 * Abstraction over the OpenSecret enclave key APIs so crypto consumers don't
 * import OpenSecret directly. Built by `openSecretKeyProvider()`.
 */
export type KeyProvider = {
  /** BIP-85 child mnemonic for the given seed-phrase derivation path. */
  getChildMnemonic(seedPhraseDerivationPath: string): Promise<string>;
  /** BIP-32 private-key bytes for the given derivation path. */
  getPrivateKeyBytes(privateKeyDerivationPath: string): Promise<Uint8Array>;
  /** BIP-32 public key (hex) for the given derivation path + algorithm. */
  getPublicKeyHex(
    privateKeyDerivationPath: string,
    algorithm: 'schnorr' | 'ecdsa',
  ): Promise<string>;
};
