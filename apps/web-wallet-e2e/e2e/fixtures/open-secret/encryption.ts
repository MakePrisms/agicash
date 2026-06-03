import { randomBytes as cryptoRandomBytes } from 'node:crypto';
import { decode, encode } from '@stablelib/base64';
import { ChaCha20Poly1305 } from '@stablelib/chacha20poly1305';

// This code was copied from Open Secret code https://github.com/OpenSecretCloud/OpenSecret-SDK/blob/master/src/lib/encryption.ts
// We only had to use different randomBytes method because the one used there didn't work for some reason.

function randomBytes(length: number): Uint8Array {
  return new Uint8Array(cryptoRandomBytes(length));
}

export const openSecretEncryption = {
  encryptMessage: function encryptMessage(
    sessionKey: Uint8Array,
    message: string,
  ): string {
    const chacha = new ChaCha20Poly1305(sessionKey);
    const nonce = randomBytes(12);
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const encrypted = chacha.seal(nonce, data);

    // Prepend the nonce to the encrypted data
    const result = new Uint8Array(nonce.length + encrypted.length);
    result.set(nonce);
    result.set(encrypted, nonce.length);

    return encode(result);
  },

  decryptMessage: function decryptMessage(
    sessionKey: Uint8Array,
    encryptedData: string,
  ): string {
    const chacha = new ChaCha20Poly1305(sessionKey);
    const encryptedBytes = decode(encryptedData);

    // Extract nonce (first 12 bytes) and ciphertext
    const nonceLength = 12;
    const nonce = encryptedBytes.slice(0, nonceLength);
    const ciphertext = encryptedBytes.slice(nonceLength);

    const decrypted = chacha.open(nonce, ciphertext);
    if (!decrypted) {
      throw new Error('Decryption failed');
    }
    return new TextDecoder().decode(decrypted);
  },
};
