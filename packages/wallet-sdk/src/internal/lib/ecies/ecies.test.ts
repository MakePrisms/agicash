import { describe, expect, it } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1';
import {
  eciesDecrypt,
  eciesDecryptBatch,
  eciesEncrypt,
  eciesEncryptBatch,
} from './ecies';

function generateKeypair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = secp256k1.utils.randomSecretKey();
  const publicKey = secp256k1.getPublicKey(privateKey, true); // 33-byte compressed
  return { privateKey, publicKey };
}

describe('eciesEncrypt / eciesDecrypt round-trip', () => {
  it('round-trips a simple byte array', () => {
    const { privateKey, publicKey } = generateKeypair();
    const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
    const encrypted = eciesEncrypt(plaintext, publicKey);
    const decrypted = eciesDecrypt(encrypted, privateKey);
    expect(decrypted).toEqual(plaintext);
  });

  it('round-trips an empty byte array', () => {
    const { privateKey, publicKey } = generateKeypair();
    const plaintext = new Uint8Array(0);
    const encrypted = eciesEncrypt(plaintext, publicKey);
    const decrypted = eciesDecrypt(encrypted, privateKey);
    expect(decrypted).toEqual(plaintext);
  });

  it('round-trips a larger byte array', () => {
    const { privateKey, publicKey } = generateKeypair();
    const plaintext = new Uint8Array(256).fill(0xab);
    const encrypted = eciesEncrypt(plaintext, publicKey);
    const decrypted = eciesDecrypt(encrypted, privateKey);
    expect(decrypted).toEqual(plaintext);
  });

  it('accepts a 32-byte (x-only) public key', () => {
    const { privateKey, publicKey } = generateKeypair();
    // Strip the leading prefix byte to get x-only (32 bytes)
    const xOnlyPubKey = publicKey.slice(1);
    expect(xOnlyPubKey.length).toBe(32);

    const plaintext = new Uint8Array([10, 20, 30]);
    const encrypted = eciesEncrypt(plaintext, xOnlyPubKey);
    const decrypted = eciesDecrypt(encrypted, privateKey);
    expect(decrypted).toEqual(plaintext);
  });
});

describe('eciesEncryptBatch / eciesDecryptBatch round-trip', () => {
  it('round-trips a batch of messages', () => {
    const { privateKey, publicKey } = generateKeypair();
    const plaintexts = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6, 7]),
      new Uint8Array([8]),
    ];
    const encrypted = eciesEncryptBatch(plaintexts, publicKey);
    const decrypted = eciesDecryptBatch(encrypted, privateKey);
    expect(decrypted).toEqual(plaintexts);
  });

  it('produces messages that share the same ephemeral public key', () => {
    const { publicKey } = generateKeypair();
    const plaintexts = [new Uint8Array([1]), new Uint8Array([2])];
    const encrypted = eciesEncryptBatch(plaintexts, publicKey);
    // All batch messages share the same 33-byte ephemeral pubkey prefix
    const sharedEphKey = encrypted[0].slice(0, 33);
    expect(encrypted[1].slice(0, 33)).toEqual(sharedEphKey);
  });

  it('preserves order in output', () => {
    const { privateKey, publicKey } = generateKeypair();
    const plaintexts = Array.from({ length: 5 }, (_, i) => new Uint8Array([i]));
    const encrypted = eciesEncryptBatch(plaintexts, publicKey);
    const decrypted = eciesDecryptBatch(encrypted, privateKey);
    for (let i = 0; i < plaintexts.length; i++) {
      expect(decrypted[i]).toEqual(plaintexts[i]);
    }
  });
});
