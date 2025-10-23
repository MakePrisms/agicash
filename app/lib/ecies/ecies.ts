/**
 * ECIES (Elliptic Curve Integrated Encryption Scheme) is a public-key encryption scheme that uses elliptic curve cryptography.
 *
 * This is an implementation of ECIES using the secp256k1 curve, ChaCha20-Poly1305 for encryption, and HKDF for key derivation.
 *
 * ## How it works:
 * - **Asymmetric**: Encrypt with recipient's public key, decrypt with their private key
 * - **Ephemeral keys**: Each message generates a new temporary key pair for forward secrecy
 * - **Hybrid approach**: Uses ECDH to create shared secret, then symmetric encryption for efficiency
 * - **Self-contained**: Ephemeral public key travels with the encrypted message
 *
 * The official specification is in [SEC 1: Elliptic Curve Cryptography Version 2.0](https://www.secg.org/sec1-v2.pdf) section 5.1
 *
 * This implementaiton is based on https://github.com/ecies/js
 */

import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { secp256k1 } from '@noble/curves/secp256k1';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';

/**
 * Maximum recommended batch size for ECIES encryption.
 * Limit is based on birthday paradox: with 96-bit random nonces,
 * collision probability becomes non-negligible after ~2^48 messages.
 * This conservative limit keeps collision risk below 1 in 10^9.
 */
const MAX_BATCH_SIZE = 10000;

/**
 * ECIES encrypt multiple data items to a public key using a single ephemeral key.
 * Each message uses the same shared secret but a unique random nonce.
 * Messages can be decrypted in any order.
 *
 * Note: Messages in a batch share an ephemeral key, making them linkable.
 * For maximum forward secrecy, use eciesEncrypt() for each message individually.
 *
 * If the input exceeds MAX_BATCH_SIZE, it will automatically be split into
 * multiple batches (each with its own ephemeral key).
 *
 * @param dataArray - Array of data to encrypt
 * @param publicKeyBytes - 32-byte (Schnorr x-only) or 33-byte (compressed) public key
 * @returns Array of encrypted messages: [ephemeralPubKey(33) || nonce(12) || ciphertext || tag(16)]
 */
export function eciesEncryptBatch(
  dataArray: Uint8Array[],
  publicKeyBytes: Uint8Array,
): Uint8Array[] {
  // Split into multiple batches if needed
  if (dataArray.length > MAX_BATCH_SIZE) {
    const results: Uint8Array[] = [];
    for (let i = 0; i < dataArray.length; i += MAX_BATCH_SIZE) {
      const chunk = dataArray.slice(i, i + MAX_BATCH_SIZE);
      results.push(...eciesEncryptBatch(chunk, publicKeyBytes));
    }
    return results;
  }

  // Step 1: Parse and validate the recipient's public key
  const recipientPublicKey = parsePublicKey(publicKeyBytes);

  // Step 2: Generate single ephemeral key pair for entire batch
  const ephemeralPrivKey = secp256k1.utils.randomSecretKey();
  const ephemeralPubKey = secp256k1.Point.BASE.multiply(
    secp256k1.Point.Fn.fromBytes(ephemeralPrivKey),
  );

  // Step 3: Compute shared secret once using ECDH
  const sharedSecret = getSharedSecret(
    ephemeralPrivKey,
    recipientPublicKey.toBytes(true),
  );

  const ephemeralPublicKeyBytes = ephemeralPubKey.toBytes(true); // 33 bytes compressed

  // Step 4: Derive shared encryption key once (no index needed)
  const encryptionKey = deriveEncryptionKey(sharedSecret);

  // Step 5-6: Encrypt each data item with unique random nonce
  return dataArray.map((data) => {
    const nonce = generateNonce();

    // Encrypt with ChaCha20-Poly1305
    const encrypted = encrypt(data, encryptionKey, nonce);

    // Construct final message
    const result = new Uint8Array(
      ephemeralPublicKeyBytes.length + nonce.length + encrypted.length,
    );

    let offset = 0;
    result.set(ephemeralPublicKeyBytes, offset);
    offset += ephemeralPublicKeyBytes.length;
    result.set(nonce, offset);
    offset += nonce.length;
    result.set(encrypted, offset);

    return result;
  });
}

/**
 * ECIES encrypt data to a public key
 * @param data - Data to encrypt
 * @param publicKeyBytes - 32-byte (Schnorr x-only) or 33-byte (compressed) public key
 * @returns Encrypted message: [ephemeralPubKey(33) || nonce(12) || ciphertext || tag(16)]
 */
export function eciesEncrypt(
  data: Uint8Array,
  publicKeyBytes: Uint8Array,
): Uint8Array {
  return eciesEncryptBatch([data], publicKeyBytes)[0];
}

/**
 * ECIES decrypt multiple encrypted messages with a private key.
 * Messages encrypted with the same ephemeral key are efficiently batched.
 * Messages can be in any order - order is preserved in output.
 * @param encryptedDataArray - Array of encrypted messages from eciesEncrypt()
 * @param privateKeyBytes - 32-byte private key
 * @returns Array of decrypted plaintexts in the same order as input
 */
export function eciesDecryptBatch(
  encryptedDataArray: Uint8Array[],
  privateKeyBytes: Uint8Array,
): Uint8Array[] {
  // Step 1: Validate the recipient's private key
  if (privateKeyBytes.length !== 32) {
    throw new Error('Private key must be 32 bytes');
  }

  // Step 2: Group encrypted messages by ephemeral public key to optimize shared secret computation
  const groups = new Map<string, Array<{ data: Uint8Array; index: number }>>();

  encryptedDataArray.forEach((encryptedData, index) => {
    const ephemeralPubKeyBytes = encryptedData.slice(0, 33);
    const key = Array.from(ephemeralPubKeyBytes).join(',');

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    const group = groups.get(key);
    if (group) {
      group.push({ data: encryptedData, index });
    }
  });

  const results: Array<{ index: number; plaintext: Uint8Array }> = [];

  // Step 3-5: Process each group with shared ephemeral key
  for (const [, group] of groups) {
    const firstItem = group[0];
    const ephemeralPubKeyBytes = firstItem.data.slice(0, 33);

    const ephemeralPubKey = secp256k1.Point.fromHex(ephemeralPubKeyBytes);

    // Step 3: Compute shared secret using ECDH
    const sharedSecret = getSharedSecret(
      privateKeyBytes,
      ephemeralPubKey.toBytes(true),
    );

    // Step 4: Derive shared encryption key
    const encryptionKey = deriveEncryptionKey(sharedSecret);

    // Step 5: Decrypt each message in the group
    for (const item of group) {
      const nonce = item.data.slice(33, 45);
      const ciphertext = item.data.slice(45);

      const plaintext = decrypt(ciphertext, encryptionKey, nonce);
      results.push({ index: item.index, plaintext });
    }
  }

  // Step 6: Sort results by original index and return plaintexts
  results.sort((a, b) => a.index - b.index);
  return results.map((r) => r.plaintext);
}

/**
 * ECIES decrypt data with a private key
 * @param encryptedData - Encrypted message from eciesEncrypt()
 * @param privateKeyBytes - 32-byte private key
 * @returns Decrypted plaintext
 */
export function eciesDecrypt(
  encryptedData: Uint8Array,
  privateKeyBytes: Uint8Array,
): Uint8Array {
  return eciesDecryptBatch([encryptedData], privateKeyBytes)[0];
}

function parsePublicKey(publicKeyBytes: Uint8Array) {
  if (publicKeyBytes.length === 32) {
    // Schnorr-style x-only public key - lift to full point
    return secp256k1.Point.fromHex(
      `02${Array.from(publicKeyBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`,
    );
  }

  if (publicKeyBytes.length === 33) {
    // Compressed public key
    return secp256k1.Point.fromHex(publicKeyBytes);
  }

  if (publicKeyBytes.length === 65) {
    // Uncompressed public key
    return secp256k1.Point.fromHex(publicKeyBytes);
  }

  throw new Error('Invalid public key length');
}

function getSharedSecret(
  privateKeyBytes: Uint8Array,
  publicKeyBytes: Uint8Array,
) {
  return secp256k1.getSharedSecret(privateKeyBytes, publicKeyBytes).slice(1); // Remove parity byte
}

function deriveEncryptionKey(sharedSecret: Uint8Array): Uint8Array {
  // Empty salt so we don't have to store it in the payload. The ephemeral key is sufficiently random.
  const salt = new Uint8Array(0);
  const info = new TextEncoder().encode('ecies-key-derivation');
  return hkdf(sha256, sharedSecret, salt, info, 32); // 32 bytes for ChaCha20 key
}

function generateNonce(): Uint8Array {
  // Generate a random 12-byte (96-bit) nonce for ChaCha20-Poly1305
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  return nonce;
}

function encrypt(
  data: Uint8Array,
  encryptionKey: Uint8Array,
  nonce: Uint8Array,
) {
  const cipher = chacha20poly1305(encryptionKey, nonce);
  return cipher.encrypt(data);
}

function decrypt(
  data: Uint8Array,
  encryptionKey: Uint8Array,
  nonce: Uint8Array,
) {
  const cipher = chacha20poly1305(encryptionKey, nonce);
  return cipher.decrypt(data);
}
