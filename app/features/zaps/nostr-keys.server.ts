import { privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { getPublicKey } from 'nostr-tools/pure';

const mnemonic = process.env.LNURL_SERVER_SPARK_MNEMONIC || '';
if (!mnemonic) {
  throw new Error('LNURL_SERVER_SPARK_MNEMONIC is not set');
}

const secret = privateKeyFromSeedWords(mnemonic, undefined, 0);
const pubkey = getPublicKey(secret);

/**
 * Returns the server's Nostr secret key, derived from the
 * `LNURL_SERVER_SPARK_MNEMONIC` via NIP-06 (m/44'/1237'/0'/0/0).
 * The 1237 SLIP-44 path is hardened and disjoint from the Bitcoin/Spark
 * derivations sharing the same seed.
 */
export function getServerNostrSecret(): Uint8Array {
  return secret;
}

/**
 * Returns the x-only schnorr pubkey corresponding to the server's Nostr secret.
 * 64-hex-char lowercase string.
 */
export function getServerNostrPubkey(): string {
  return pubkey;
}
