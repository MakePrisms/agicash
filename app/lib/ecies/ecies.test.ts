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

  test('automatically splits large batches exceeding MAX_BATCH_SIZE', () => {
    // Create an array larger than MAX_BATCH_SIZE (10,000)
    const largeArray = Array.from({ length: 15000 }, (_, i) =>
      new TextEncoder().encode(`Message ${i}`),
    );

    // Should not throw - automatically splits into batches
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

  test('decrypt 1000 buckets with 3 items each', () => {
    const bucketCount = 1000;
    const itemsPerBucket = 3;
    const allEncrypted: Uint8Array[] = [];

    // Create 1000 separate encryption batches, each with 3 items
    for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex++) {
      const bucket = Array.from({ length: itemsPerBucket }, (_, itemIndex) =>
        new TextEncoder().encode(`Bucket ${bucketIndex} - Item ${itemIndex}`),
      );

      const encrypted = eciesEncryptBatch(bucket, publicKeyCompressed);
      allEncrypted.push(...encrypted);
    }

    // Verify we have 3000 total encrypted messages
    expect(allEncrypted.length).toBe(bucketCount * itemsPerBucket);

    // Decrypt all 3000 messages at once
    const decrypted = eciesDecryptBatch(allEncrypted, privateKey);
    expect(decrypted.length).toBe(bucketCount * itemsPerBucket);

    // Spot check messages from different buckets
    expect(new TextDecoder().decode(decrypted[0])).toBe('Bucket 0 - Item 0');
    expect(new TextDecoder().decode(decrypted[1])).toBe('Bucket 0 - Item 1');
    expect(new TextDecoder().decode(decrypted[2])).toBe('Bucket 0 - Item 2');
    expect(new TextDecoder().decode(decrypted[3])).toBe('Bucket 1 - Item 0');
    expect(new TextDecoder().decode(decrypted[1500])).toBe(
      'Bucket 500 - Item 0',
    );
    expect(new TextDecoder().decode(decrypted[2997])).toBe(
      'Bucket 999 - Item 0',
    );
    expect(new TextDecoder().decode(decrypted[2998])).toBe(
      'Bucket 999 - Item 1',
    );
    expect(new TextDecoder().decode(decrypted[2999])).toBe(
      'Bucket 999 - Item 2',
    );
  });
});
