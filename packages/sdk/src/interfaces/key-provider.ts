export type KeyProvider = {
  getPrivateKeyBytes(params: {
    seed_phrase_derivation_path?: string;
    private_key_derivation_path?: string;
  }): Promise<{ private_key: string }>;

  getPublicKey(
    type: 'schnorr',
    params: { private_key_derivation_path: string },
  ): Promise<{ public_key: string }>;

  getMnemonic(params: {
    seed_phrase_derivation_path: string;
  }): Promise<{ mnemonic: string }>;
};
