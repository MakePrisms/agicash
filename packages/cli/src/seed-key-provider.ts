import type { KeyProvider } from '@agicash/core';
import { schnorr } from '@noble/curves/secp256k1';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha2';
import { HDKey } from '@scure/bip32';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Derives a child mnemonic from a master seed using BIP-85.
 *
 * BIP-85 path format: m/83696968'/39'/language'/words'/index'
 * - 83696968 = "SEED" in ASCII
 * - 39 = BIP-39 application
 * - language = 0 (English)
 * - words = 12 or 24
 * - index = account index
 *
 * Process: derive child key at BIP85 path → HMAC-SHA512 with key "bip-entropy-from-k"
 * → take first N bytes as entropy → convert to BIP39 mnemonic
 */
function bip85DeriveMnemonic(
  masterSeed: Uint8Array,
  derivationPath: string,
): string {
  const master = HDKey.fromMasterSeed(masterSeed);
  const child = master.derive(derivationPath);
  if (!child.privateKey) throw new Error('BIP85: failed to derive private key');

  // HMAC-SHA512 with the BIP85 key
  const entropy = hmac(sha512, 'bip-entropy-from-k', child.privateKey);

  // Parse the path to determine word count → entropy bytes needed
  // Path: m/83696968'/39'/0'/words'/index'
  const parts = derivationPath.replace(/'/g, '').split('/');
  const words = Number(parts[4]);
  const entropyBytes = words === 12 ? 16 : 32;

  return entropyToMnemonic(entropy.slice(0, entropyBytes), wordlist);
}

/**
 * KeyProvider backed by a BIP39 mnemonic seed phrase.
 * Implements the same key derivation as OpenSecret but without browser dependencies.
 */
export function createSeedKeyProvider(mnemonic: string): KeyProvider {
  const masterSeed = mnemonicToSeedSync(mnemonic);

  return {
    async getPrivateKeyBytes(params) {
      let seed = masterSeed;

      // If seed_phrase_derivation_path is provided, derive a sub-mnemonic first (BIP85)
      // then use that sub-mnemonic's seed for the private key derivation
      if (params.seed_phrase_derivation_path) {
        const subMnemonic = bip85DeriveMnemonic(
          masterSeed,
          params.seed_phrase_derivation_path,
        );
        seed = mnemonicToSeedSync(subMnemonic);
      }

      const master = HDKey.fromMasterSeed(seed);

      if (params.private_key_derivation_path) {
        const child = master.derive(params.private_key_derivation_path);
        if (!child.privateKey)
          throw new Error('Failed to derive private key at path');
        return { private_key: bytesToHex(child.privateKey) };
      }

      if (!master.privateKey)
        throw new Error('Failed to get master private key');
      return { private_key: bytesToHex(master.privateKey) };
    },

    async getPublicKey(type, params) {
      if (type !== 'schnorr') throw new Error(`Unsupported key type: ${type}`);

      const master = HDKey.fromMasterSeed(masterSeed);
      const child = master.derive(params.private_key_derivation_path);
      if (!child.privateKey)
        throw new Error('Failed to derive private key for public key');

      const pubkey = schnorr.getPublicKey(child.privateKey);
      return { public_key: bytesToHex(pubkey) };
    },

    async getMnemonic(params) {
      const subMnemonic = bip85DeriveMnemonic(
        masterSeed,
        params.seed_phrase_derivation_path,
      );
      return { mnemonic: subMnemonic };
    },
  };
}
