import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * Generate a random secp256k1 key pair.
 *
 * - When `asBytes` is `true`, returns raw `Uint8Array` keys.
 * - Otherwise returns hex-encoded string keys.
 */
export function generateRandomKeyPair({ asBytes }: { asBytes: true }): {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
};
export function generateRandomKeyPair({ asBytes }: { asBytes: false }): {
  privateKey: string;
  publicKey: string;
};
export function generateRandomKeyPair({ asBytes }: { asBytes: boolean }) {
  const { secretKey, publicKey } = secp256k1.keygen();

  if (asBytes) {
    return { privateKey: secretKey, publicKey };
  }

  return {
    privateKey: bytesToHex(secretKey),
    publicKey: bytesToHex(publicKey),
  };
}

/**
 * Get the compressed public key from a private key.
 *
 * @param privateKey The secp256k1 private key to get the public key from.
 * @param asBytes Whether to return the public key as bytes or hex-encoded string.
 * @returns The compressed public key in the specified format.
 */
export function getPublicKeyFromPrivateKey(
  privateKey: string | Uint8Array,
  { asBytes }: { asBytes: true },
): Uint8Array;
export function getPublicKeyFromPrivateKey(
  privateKey: string | Uint8Array,
  { asBytes }: { asBytes: false },
): string;
export function getPublicKeyFromPrivateKey(
  privateKey: string | Uint8Array,
  { asBytes }: { asBytes: boolean },
): Uint8Array | string {
  const isCompressed = true;
  const publicKey = secp256k1.getPublicKey(
    typeof privateKey === 'string' ? privateKey : bytesToHex(privateKey),
    isCompressed,
  );
  if (asBytes) {
    return publicKey;
  }
  return bytesToHex(publicKey);
}
