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
    expect(new TextDecoder().decode(decrypted[150])).toBe(
      'Bucket 50 - Item 0',
    );
    expect(new TextDecoder().decode(decrypted[297])).toBe(
      'Bucket 99 - Item 0',
    );
    expect(new TextDecoder().decode(decrypted[298])).toBe(
      'Bucket 99 - Item 1',
    );
    expect(new TextDecoder().decode(decrypted[299])).toBe(
      'Bucket 99 - Item 2',
    );
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
});
