import type { KeyProvider } from '@agicash/sdk/interfaces/key-provider';
import { schnorr } from '@noble/curves/secp256k1';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha2';
import { HDKey } from '@scure/bip32';
import {
  entropyToMnemonic,
  mnemonicToSeedSync,
  validateMnemonic,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

/**
 * Derives a child mnemonic from a master seed using BIP-85.
 *
 * BIP-85 specifies:
 * 1. Derive HD key at the given path from master seed
 * 2. HMAC-SHA512 the child private key with key "bip-entropy-from-k"
 * 3. Take the first N bytes as entropy for the child mnemonic
 *
 * The derivation path format is m/83696968'/39'/0'/{words}'/{index}'
 * where 83696968 = "SEED" in ASCII, 39 = BIP-39 application,
 * 0 = English, words = 12/18/24, index = unique seed index.
 */
function bip85DeriveChildMnemonic(
  masterSeed: Uint8Array,
  derivationPath: string,
): string {
  const masterKey = HDKey.fromMasterSeed(masterSeed);
  const childKey = masterKey.derive(derivationPath);

  if (!childKey.privateKey) {
    throw new Error('BIP-85 derivation failed: no private key at path');
  }

  const entropy = hmac(sha512, 'bip-entropy-from-k', childKey.privateKey);

  // Parse word count from the derivation path to determine entropy size.
  // Path format: m/83696968'/39'/0'/{words}'/{index}'
  const parts = derivationPath.replace(/'/g, '').split('/');
  const wordCount = Number.parseInt(parts[4], 10);

  let entropyBytes: number;
  switch (wordCount) {
    case 12:
      entropyBytes = 16; // 128 bits
      break;
    case 18:
      entropyBytes = 24; // 192 bits
      break;
    case 24:
      entropyBytes = 32; // 256 bits
      break;
    default:
      throw new Error(`Unsupported BIP-85 word count: ${wordCount}`);
  }

  const childEntropy = entropy.slice(0, entropyBytes);
  return entropyToMnemonic(childEntropy, wordlist);
}

/**
 * Creates a KeyProvider that reads a BIP39 mnemonic from the AGICASH_MNEMONIC
 * environment variable and performs deterministic key derivation locally.
 *
 * This replicates what OpenSecret does server-side in the web app:
 * - getMnemonic: BIP-85 derivation from master mnemonic to child mnemonic
 * - getPrivateKeyBytes: BIP-85 + optional BIP-32 derivation to private key bytes
 * - getPublicKey: derives schnorr public key from private key bytes
 */
function createLocalKeyProvider(mnemonic: string): KeyProvider {
  const masterSeed = mnemonicToSeedSync(mnemonic);

  return {
    async getPrivateKeyBytes(params) {
      let seed: Uint8Array;

      if (params.seed_phrase_derivation_path) {
        // BIP-85: derive child mnemonic, then use its seed
        const childMnemonic = bip85DeriveChildMnemonic(
          masterSeed,
          params.seed_phrase_derivation_path,
        );
        seed = mnemonicToSeedSync(childMnemonic);
      } else {
        seed = masterSeed;
      }

      const hdKey = HDKey.fromMasterSeed(seed);

      if (params.private_key_derivation_path) {
        // BIP-32: derive child key from the (possibly BIP-85-derived) seed
        const childKey = hdKey.derive(params.private_key_derivation_path);
        if (!childKey.privateKey) {
          throw new Error(
            `No private key at derivation path: ${params.private_key_derivation_path}`,
          );
        }
        return {
          private_key: Buffer.from(childKey.privateKey).toString('hex'),
        };
      }

      if (!hdKey.privateKey) {
        throw new Error('No master private key');
      }
      return { private_key: Buffer.from(hdKey.privateKey).toString('hex') };
    },

    async getPublicKey(type, params) {
      if (type !== 'schnorr') {
        throw new Error(`Unsupported public key type: ${type}`);
      }

      const { private_key } = await this.getPrivateKeyBytes({
        private_key_derivation_path: params.private_key_derivation_path,
      });

      const pubKey = schnorr.getPublicKey(private_key);
      return { public_key: Buffer.from(pubKey).toString('hex') };
    },

    async getMnemonic(params) {
      if (params.seed_phrase_derivation_path) {
        const childMnemonic = bip85DeriveChildMnemonic(
          masterSeed,
          params.seed_phrase_derivation_path,
        );
        return { mnemonic: childMnemonic };
      }
      return { mnemonic };
    },
  };
}

let cachedProvider: KeyProvider | null = null;
let cachedMnemonic: string | null = null;

/**
 * Returns the cashu BIP39 seed derived from the mnemonic via BIP-85.
 * This matches the web app's seed derivation: BIP-85 at the cashu path,
 * then mnemonicToSeedSync on the child mnemonic.
 */
export function getCashuSeed(mnemonic: string): Uint8Array {
  const masterSeed = mnemonicToSeedSync(mnemonic);
  // Same derivation path used by the web app (cashu account, 12 words)
  const childMnemonic = bip85DeriveChildMnemonic(
    masterSeed,
    "m/83696968'/39'/0'/12'/0'",
  );
  return mnemonicToSeedSync(childMnemonic);
}

/**
 * Creates and caches a KeyProvider from AGICASH_MNEMONIC.
 * Returns the same instance if the mnemonic hasn't changed.
 */
export function getKeyProvider(): KeyProvider {
  const mnemonic = process.env.AGICASH_MNEMONIC;

  if (!mnemonic) {
    throw new Error(
      'AGICASH_MNEMONIC is not set. See `agicash help` for instructions.',
    );
  }

  if (cachedProvider && cachedMnemonic === mnemonic) {
    return cachedProvider;
  }

  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error(
      'AGICASH_MNEMONIC is not a valid BIP39 mnemonic. ' +
        'It should be 12 or 24 space-separated words.',
    );
  }

  cachedProvider = createLocalKeyProvider(mnemonic);
  cachedMnemonic = mnemonic;
  return cachedProvider;
}

/**
 * Returns true if AGICASH_MNEMONIC is set in the environment.
 */
export function hasMnemonic(): boolean {
  return Boolean(process.env.AGICASH_MNEMONIC);
}
