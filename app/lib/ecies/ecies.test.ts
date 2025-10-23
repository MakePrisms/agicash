import { describe, expect, test } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1';
import {
  eciesDecrypt,
  eciesDecryptBatch,
  eciesEncrypt,
  eciesEncryptBatch,
} from '.';

describe('ECIES Encryption/Decryption', () => {
  // Generate test key pair
  const privateKey = secp256k1.utils.randomSecretKey();
  const publicKey = secp256k1.Point.BASE.multiply(
    secp256k1.Point.Fn.fromBytes(privateKey),
  );
  const publicKeyCompressed = publicKey.toRawBytes(true); // 33 bytes
  const publicKeySchnorr = publicKey.toRawBytes(false).slice(1, 33); // 32 bytes x-only

  test('round trip: single encrypt and decrypt', () => {
    const plaintext = new TextEncoder().encode('Hello, World!');

    const encrypted = eciesEncrypt(plaintext, publicKeyCompressed);
    const decrypted = eciesDecrypt(encrypted, privateKey);

    expect(decrypted).toEqual(plaintext);
  });

  test('round trip: batch encrypt and decrypt', () => {
    const plaintexts = [
      new TextEncoder().encode('Message 1'),
      new TextEncoder().encode('Message 2'),
      new TextEncoder().encode('Message 3'),
    ];

    const encrypted = eciesEncryptBatch(plaintexts, publicKeyCompressed);
    const decrypted = eciesDecryptBatch(encrypted, privateKey);

    expect(decrypted).toEqual(plaintexts);
  });

  test('batch encrypt -> single decrypt', () => {
    const plaintexts = [
      new TextEncoder().encode('First'),
      new TextEncoder().encode('Second'),
    ];

    const encrypted = eciesEncryptBatch(plaintexts, publicKeyCompressed);

    // Decrypt each individually
    const decrypted1 = eciesDecrypt(encrypted[0], privateKey);
    const decrypted2 = eciesDecrypt(encrypted[1], privateKey);

    expect(decrypted1).toEqual(plaintexts[0]);
    expect(decrypted2).toEqual(plaintexts[1]);
  });

  test('single encrypt -> batch decrypt', () => {
    const plaintext1 = new TextEncoder().encode('Alpha');
    const plaintext2 = new TextEncoder().encode('Beta');

    const encrypted1 = eciesEncrypt(plaintext1, publicKeyCompressed);
    const encrypted2 = eciesEncrypt(plaintext2, publicKeyCompressed);

    // Decrypt as batch
    const decrypted = eciesDecryptBatch([encrypted1, encrypted2], privateKey);

    expect(decrypted[0]).toEqual(plaintext1);
    expect(decrypted[1]).toEqual(plaintext2);
  });

  test('works with Schnorr x-only public key (32 bytes)', () => {
    const plaintext = new TextEncoder().encode('Schnorr test');

    const encrypted = eciesEncrypt(plaintext, publicKeySchnorr);
    const decrypted = eciesDecrypt(encrypted, privateKey);

    expect(decrypted).toEqual(plaintext);
  });

  test('tampering with nonce causes decryption to fail', () => {
    const plaintext = new TextEncoder().encode('Secret message');
    const encrypted = eciesEncrypt(plaintext, publicKeyCompressed);

    // Structure: [ephemeralPubKey(33) || nonce(12) || ciphertext || tag(16)]
    // Tamper with the nonce (bytes 33-45)
    const tampered = new Uint8Array(encrypted);
    tampered[35] ^= 0xff; // Flip bits in the nonce

    expect(() => {
      eciesDecrypt(tampered, privateKey);
    }).toThrow();
  });

  test('tampering with ciphertext causes decryption to fail', () => {
    const plaintext = new TextEncoder().encode('Another secret');
    const encrypted = eciesEncrypt(plaintext, publicKeyCompressed);

    // Tamper with the ciphertext (after byte 45)
    const tampered = new Uint8Array(encrypted);
    tampered[50] ^= 0xff;

    expect(() => {
      eciesDecrypt(tampered, privateKey);
    }).toThrow();
  });

  test('wrong private key cannot decrypt', () => {
    const plaintext = new TextEncoder().encode('Protected data');
    const encrypted = eciesEncrypt(plaintext, publicKeyCompressed);

    const wrongPrivateKey = secp256k1.utils.randomSecretKey();

    expect(() => {
      eciesDecrypt(encrypted, wrongPrivateKey);
    }).toThrow();
  });

  test('batch decryption preserves order', () => {
    const plaintexts = [
      new TextEncoder().encode('First'),
      new TextEncoder().encode('Second'),
      new TextEncoder().encode('Third'),
      new TextEncoder().encode('Fourth'),
    ];

    const encrypted = eciesEncryptBatch(plaintexts, publicKeyCompressed);
    const decrypted = eciesDecryptBatch(encrypted, privateKey);

    for (let i = 0; i < plaintexts.length; i++) {
      expect(decrypted[i]).toEqual(plaintexts[i]);
    }
  });

  test('batch decryption with shuffled messages preserves order', () => {
    const plaintexts = [
      new TextEncoder().encode('A'),
      new TextEncoder().encode('B'),
      new TextEncoder().encode('C'),
    ];

    const encrypted = eciesEncryptBatch(plaintexts, publicKeyCompressed);

    // Shuffle the encrypted messages
    const shuffled = [encrypted[2], encrypted[0], encrypted[1]];

    // Decrypt should still work (each message is independent)
    const decrypted = eciesDecryptBatch(shuffled, privateKey);

    expect(decrypted[0]).toEqual(plaintexts[2]);
    expect(decrypted[1]).toEqual(plaintexts[0]);
    expect(decrypted[2]).toEqual(plaintexts[1]);
  });

  test('empty data encryption and decryption', () => {
    const plaintext = new Uint8Array(0);

    const encrypted = eciesEncrypt(plaintext, publicKeyCompressed);
    const decrypted = eciesDecrypt(encrypted, privateKey);

    expect(decrypted).toEqual(plaintext);
  });

  test('large data encryption and decryption', () => {
    // 1MB of data
    const plaintext = new Uint8Array(1024 * 1024);
    crypto.getRandomValues(plaintext);

    const encrypted = eciesEncrypt(plaintext, publicKeyCompressed);
    const decrypted = eciesDecrypt(encrypted, privateKey);

    expect(decrypted).toEqual(plaintext);
  });

  test('decrypt multiple batches together', () => {
    // Encrypt in two separate batches
    const batch1 = [
      new TextEncoder().encode('Batch 1 - Message 1'),
      new TextEncoder().encode('Batch 1 - Message 2'),
    ];
    const batch2 = [
      new TextEncoder().encode('Batch 2 - Message 1'),
      new TextEncoder().encode('Batch 2 - Message 2'),
      new TextEncoder().encode('Batch 2 - Message 3'),
    ];

    const encrypted1 = eciesEncryptBatch(batch1, publicKeyCompressed);
    const encrypted2 = eciesEncryptBatch(batch2, publicKeyCompressed);

    // Combine all encrypted messages and decrypt together
    const allEncrypted = [...encrypted1, ...encrypted2];
    const decrypted = eciesDecryptBatch(allEncrypted, privateKey);

    // Verify all messages decrypted correctly
    expect(decrypted[0]).toEqual(batch1[0]);
    expect(decrypted[1]).toEqual(batch1[1]);
    expect(decrypted[2]).toEqual(batch2[0]);
    expect(decrypted[3]).toEqual(batch2[1]);
    expect(decrypted[4]).toEqual(batch2[2]);
  });

  test('counter-based nonces work with large batches', () => {
    // Create a large batch (15,000 messages) to test counter-based nonces
    const largeArray = Array.from({ length: 15000 }, (_, i) =>
      new TextEncoder().encode(`Message ${i}`),
    );

    const encrypted = eciesEncryptBatch(largeArray, publicKeyCompressed);
    expect(encrypted.length).toBe(15000);

    // Verify all can be decrypted correctly
    const decrypted = eciesDecryptBatch(encrypted, privateKey);
    expect(decrypted.length).toBe(15000);

    // Spot check a few messages
    expect(new TextDecoder().decode(decrypted[0])).toBe('Message 0');
    expect(new TextDecoder().decode(decrypted[9999])).toBe('Message 9999');
    expect(new TextDecoder().decode(decrypted[10000])).toBe('Message 10000');
    expect(new TextDecoder().decode(decrypted[14999])).toBe('Message 14999');
  });

  test('decrypt 100 buckets with 3 items each', () => {
    const bucketCount = 100;
    const itemsPerBucket = 3;
    const allEncrypted: Uint8Array[] = [];

    // Create 100 separate encryption batches, each with 3 items
    for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex++) {
      const bucket = Array.from({ length: itemsPerBucket }, (_, itemIndex) =>
        new TextEncoder().encode(`Bucket ${bucketIndex} - Item ${itemIndex}`),
      );

      const encrypted = eciesEncryptBatch(bucket, publicKeyCompressed);
      allEncrypted.push(...encrypted);
    }

    // Verify we have 300 total encrypted messages
    expect(allEncrypted.length).toBe(bucketCount * itemsPerBucket);

    // Decrypt all 300 messages at once
    const decrypted = eciesDecryptBatch(allEncrypted, privateKey);
    expect(decrypted.length).toBe(bucketCount * itemsPerBucket);

    // Spot check messages from different buckets
    expect(new TextDecoder().decode(decrypted[0])).toBe('Bucket 0 - Item 0');
    expect(new TextDecoder().decode(decrypted[1])).toBe('Bucket 0 - Item 1');
    expect(new TextDecoder().decode(decrypted[2])).toBe('Bucket 0 - Item 2');
    expect(new TextDecoder().decode(decrypted[3])).toBe('Bucket 1 - Item 0');
    expect(new TextDecoder().decode(decrypted[150])).toBe('Bucket 50 - Item 0');
    expect(new TextDecoder().decode(decrypted[297])).toBe('Bucket 99 - Item 0');
    expect(new TextDecoder().decode(decrypted[298])).toBe('Bucket 99 - Item 1');
    expect(new TextDecoder().decode(decrypted[299])).toBe('Bucket 99 - Item 2');
  });

  test('counter-based nonces are deterministic and unique within batch', () => {
    const plaintext = new TextEncoder().encode('Test message');

    // Encrypt the same message twice with different ephemeral keys
    const encrypted1 = eciesEncrypt(plaintext, publicKeyCompressed);
    const encrypted2 = eciesEncrypt(plaintext, publicKeyCompressed);

    // Extract nonces (bytes 33-45) - both will be counter 0
    const nonce1 = encrypted1.slice(33, 45);
    const nonce2 = encrypted2.slice(33, 45);

    // Single messages always start at counter 0, so nonces are the same
    // This is secure because they have different ephemeral keys (different encryption keys)
    expect(nonce1).toEqual(nonce2);
    expect(nonce1).toEqual(new Uint8Array(12)); // Should be all zeros (counter 0)

    // Extract ephemeral public keys - should be different (different batches)
    const ephemeralKey1 = encrypted1.slice(0, 33);
    const ephemeralKey2 = encrypted2.slice(0, 33);
    expect(ephemeralKey1).not.toEqual(ephemeralKey2);

    // Now test batch - all messages in same batch share ephemeral key
    const batch = [
      new TextEncoder().encode('Message 1'),
      new TextEncoder().encode('Message 2'),
      new TextEncoder().encode('Message 3'),
    ];

    const encryptedBatch = eciesEncryptBatch(batch, publicKeyCompressed);

    // Extract nonces from batch - should be counters 0, 1, 2
    const batchNonce1 = encryptedBatch[0].slice(33, 45);
    const batchNonce2 = encryptedBatch[1].slice(33, 45);
    const batchNonce3 = encryptedBatch[2].slice(33, 45);

    // Verify first nonce is counter 0
    expect(batchNonce1).toEqual(new Uint8Array(12));

    // Verify second nonce is counter 1
    const expectedNonce2 = new Uint8Array(12);
    expectedNonce2[11] = 1;
    expect(batchNonce2).toEqual(expectedNonce2);

    // Verify third nonce is counter 2
    const expectedNonce3 = new Uint8Array(12);
    expectedNonce3[11] = 2;
    expect(batchNonce3).toEqual(expectedNonce3);

    // All should be different
    expect(batchNonce1).not.toEqual(batchNonce2);
    expect(batchNonce2).not.toEqual(batchNonce3);
    expect(batchNonce1).not.toEqual(batchNonce3);

    // Extract ephemeral public keys - should be same within batch
    const ephemeralKeyBatch1 = encryptedBatch[0].slice(0, 33);
    const ephemeralKeyBatch2 = encryptedBatch[1].slice(0, 33);
    const ephemeralKeyBatch3 = encryptedBatch[2].slice(0, 33);

    expect(ephemeralKeyBatch1).toEqual(ephemeralKeyBatch2);
    expect(ephemeralKeyBatch2).toEqual(ephemeralKeyBatch3);
  });

  test('hardcoded encrypted values can always be decrypted (backward compatibility)', () => {
    // Fixed test key pair (not randomly generated)
    // Private key: all ones for testing
    const fixedPrivateKey = new Uint8Array(32).fill(1);

    // These encrypted values were generated once with the fixed key pair above
    // They test that the decryption algorithm remains backward compatible
    // If decryption changes, these tests will fail, alerting us to breaking changes

    // Test case 1: "Hello, World!"
    const encrypted1 = new Uint8Array([
      2, 97, 175, 66, 144, 139, 76, 166, 58, 65, 37, 199, 232, 185, 74, 109,
      105, 66, 2, 210, 88, 234, 180, 177, 4, 16, 143, 35, 16, 155, 33, 130, 58,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 200, 60, 166, 140, 186, 206, 231, 190,
      243, 205, 149, 209, 118, 32, 55, 118, 214, 58, 143, 31, 166, 4, 226, 101,
      137, 229, 213, 75, 121,
    ]);
    const expectedPlaintext1 = 'Hello, World!';

    // Test case 2: Empty string ""
    const encrypted2 = new Uint8Array([
      2, 129, 123, 92, 212, 122, 199, 41, 79, 156, 79, 231, 69, 228, 216, 17,
      117, 216, 94, 250, 11, 80, 173, 121, 39, 207, 250, 112, 225, 236, 187,
      108, 242, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 82, 245, 36, 88, 169, 91,
      135, 252, 250, 71, 148, 179, 158, 243, 246, 243,
    ]);
    const expectedPlaintext2 = '';

    // Test case 3: Unicode "Hello 🌍!"
    const encrypted3 = new Uint8Array([
      2, 102, 144, 206, 159, 57, 177, 229, 10, 169, 214, 93, 242, 177, 105, 224,
      119, 39, 221, 182, 94, 214, 157, 185, 194, 106, 164, 27, 52, 117, 117,
      114, 72, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 71, 191, 228, 3, 47, 158,
      142, 205, 102, 244, 187, 188, 35, 169, 109, 168, 104, 162, 23, 172, 154,
      235, 47, 37, 205, 107,
    ]);
    const expectedPlaintext3 = 'Hello 🌍!';

    // Decrypt and verify
    const decrypted1 = eciesDecrypt(encrypted1, fixedPrivateKey);
    const decrypted2 = eciesDecrypt(encrypted2, fixedPrivateKey);
    const decrypted3 = eciesDecrypt(encrypted3, fixedPrivateKey);

    expect(new TextDecoder().decode(decrypted1)).toBe(expectedPlaintext1);
    expect(new TextDecoder().decode(decrypted2)).toBe(expectedPlaintext2);
    expect(new TextDecoder().decode(decrypted3)).toBe(expectedPlaintext3);
  });

  test('hardcoded batch encrypted values can always be decrypted (backward compatibility)', () => {
    // Fixed test key pair (not randomly generated)
    // Private key: all ones for testing
    const fixedPrivateKey = new Uint8Array(32).fill(1);

    // These batch encrypted values were generated with eciesEncryptBatch
    // All messages share the same ephemeral key (first 33 bytes) but have different nonces
    // Notice the nonce counters: 0 (byte 44), 1 (byte 44), 2 (byte 44)
    // This tests backward compatibility for batch decryption

    // Batch message 1: "First" (nonce counter: 0)
    const encryptedBatch1 = new Uint8Array([
      3, 118, 19, 108, 82, 181, 6, 106, 32, 116, 121, 207, 67, 211, 5, 254, 165,
      203, 77, 234, 214, 176, 3, 175, 207, 238, 205, 227, 75, 252, 72, 122, 99,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 52, 248, 46, 109, 11, 95, 48, 192, 38,
      187, 199, 119, 80, 36, 122, 93, 151, 166, 164, 69, 9,
    ]);

    // Batch message 2: "Second" (nonce counter: 1)
    const encryptedBatch2 = new Uint8Array([
      3, 118, 19, 108, 82, 181, 6, 106, 32, 116, 121, 207, 67, 211, 5, 254, 165,
      203, 77, 234, 214, 176, 3, 175, 207, 238, 205, 227, 75, 252, 72, 122, 99,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 83, 7, 171, 254, 28, 83, 221, 133,
      147, 57, 21, 47, 65, 78, 11, 223, 141, 165, 40, 83, 162, 147,
    ]);

    // Batch message 3: "Third" (nonce counter: 2)
    const encryptedBatch3 = new Uint8Array([
      3, 118, 19, 108, 82, 181, 6, 106, 32, 116, 121, 207, 67, 211, 5, 254, 165,
      203, 77, 234, 214, 176, 3, 175, 207, 238, 205, 227, 75, 252, 72, 122, 99,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 218, 237, 4, 47, 234, 65, 197, 147, 5,
      57, 109, 212, 26, 179, 6, 55, 240, 44, 184, 14, 26,
    ]);

    // Decrypt batch and verify
    const decrypted = eciesDecryptBatch(
      [encryptedBatch1, encryptedBatch2, encryptedBatch3],
      fixedPrivateKey,
    );

    expect(new TextDecoder().decode(decrypted[0])).toBe('First');
    expect(new TextDecoder().decode(decrypted[1])).toBe('Second');
    expect(new TextDecoder().decode(decrypted[2])).toBe('Third');

    // Also verify each can be decrypted individually
    expect(
      new TextDecoder().decode(eciesDecrypt(encryptedBatch1, fixedPrivateKey)),
    ).toBe('First');
    expect(
      new TextDecoder().decode(eciesDecrypt(encryptedBatch2, fixedPrivateKey)),
    ).toBe('Second');
    expect(
      new TextDecoder().decode(eciesDecrypt(encryptedBatch3, fixedPrivateKey)),
    ).toBe('Third');
  });
});
