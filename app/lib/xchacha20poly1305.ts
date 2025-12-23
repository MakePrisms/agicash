import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { randomBytes } from '@noble/ciphers/webcrypto';

// 24 bytes (192 bits) is the recommended nonce length for xChaCha20-Poly1305
const NONCE_LENGTH = 24;

/**
 * Encrypts data using xChaCha20-Poly1305
 * @param data - The data to encrypt
 * @param key - The key to use for encryption
 * @returns The encrypted data
 */
export function encryptXChaCha20Poly1305(
  data: Uint8Array,
  key: Uint8Array,
): Uint8Array {
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(data);
  const result = new Uint8Array(NONCE_LENGTH + ciphertext.length);
  result.set(nonce);
  result.set(ciphertext, NONCE_LENGTH);
  return result;
}

/**
 * Decrypts data using xChaCha20-Poly1305
 * @param encryptedData - The encrypted data
 * @param key - The key to use for decryption
 * @returns The decrypted data
 */
export function decryptXChaCha20Poly1305(
  encryptedData: Uint8Array,
  key: Uint8Array,
): Uint8Array {
  const nonce = encryptedData.slice(0, NONCE_LENGTH);
  const ciphertext = encryptedData.slice(NONCE_LENGTH);
  const cipher = xchacha20poly1305(key, nonce);
  return cipher.decrypt(ciphertext);
}
