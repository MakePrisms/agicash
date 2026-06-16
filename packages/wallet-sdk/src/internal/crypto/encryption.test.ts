import { describe, expect, it } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { EncryptionService, getEncryption } from './encryption';
import type { KeyProvider } from './keys';

const priv = secp256k1.utils.randomPrivateKey();
const pubHex = bytesToHex(secp256k1.getPublicKey(priv, true));

describe('getEncryption', () => {
  it('round-trips an object (incl. Date) via encrypt/decrypt', async () => {
    const enc = getEncryption(priv, pubHex);
    const data = { a: 1, when: new Date('2026-01-01T00:00:00.000Z') };
    const cipher = await enc.encrypt(data);
    expect(typeof cipher).toBe('string');
    const out = await enc.decrypt<typeof data>(cipher);
    expect(out.a).toBe(1);
    expect(out.when instanceof Date).toBe(true);
  });

  it('round-trips a batch preserving order', async () => {
    const enc = getEncryption(priv, pubHex);
    const cipher = await enc.encryptBatch([10, 'x', true] as const);
    expect(await enc.decryptBatch(cipher)).toEqual([10, 'x', true]);
  });
});

describe('EncryptionService', () => {
  it('derives the keypair at ENCRYPTION_KEY_PATH and memoizes', async () => {
    let privCalls = 0;
    const keys: KeyProvider = {
      getChildMnemonic: async () => 'm',
      getPrivateKeyBytes: async (path) => {
        expect(path).toBe("m/10111099'/0'");
        privCalls += 1;
        return priv;
      },
      getPublicKeyHex: async (path) => {
        expect(path).toBe("m/10111099'/0'");
        return pubHex;
      },
    };
    const svc = new EncryptionService(keys);
    const a = await svc.get();
    const b = await svc.get();
    expect(a).toBe(b);
    expect(privCalls).toBe(1);
    expect(await a.decrypt<string>(await a.encrypt('hi'))).toBe('hi');
  });
});
