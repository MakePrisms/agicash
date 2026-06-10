import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/utils/money';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { getEncryption } from './encryption';

const privateKey = secp256k1.utils.randomSecretKey();
const publicKeyHex = bytesToHex(
  secp256k1.Point.BASE.multiply(
    secp256k1.Point.Fn.fromBytes(privateKey),
  ).toRawBytes(true),
);
const encryption = getEncryption(privateKey, publicKeyHex);

describe('getEncryption', () => {
  it('round-trips plain data', async () => {
    const data = { hello: 'world', n: 42, nested: { list: [1, 2, 3] } };
    const decrypted = await encryption.decrypt(await encryption.encrypt(data));
    expect(decrypted).toEqual(data);
  });

  it('preserves Date, undefined, non-finite numbers and Money through serialization', async () => {
    const data = {
      date: new Date('2024-01-02T03:04:05.000Z'),
      missing: undefined,
      inf: Number.POSITIVE_INFINITY,
      amount: new Money({ amount: 21, currency: 'BTC', unit: 'sat' }),
    };
    const decrypted = await encryption.decrypt<typeof data>(
      await encryption.encrypt(data),
    );
    expect(decrypted.date).toEqual(data.date);
    expect(decrypted.missing).toBeUndefined();
    expect(decrypted.inf).toBe(Number.POSITIVE_INFINITY);
    expect(decrypted.amount).toBeInstanceOf(Money);
    expect(decrypted.amount.equals(data.amount)).toBe(true);
  });

  it('round-trips a batch preserving order', async () => {
    const items: Record<string, unknown>[] = [
      { a: 1 },
      { b: 'two' },
      { c: [3] },
    ];
    const encrypted = await encryption.encryptBatch(items);
    const decrypted = await encryption.decryptBatch<typeof items>(encrypted);
    expect(decrypted).toEqual(items);
  });
});
