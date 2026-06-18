import { describe, expect, it } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1';
import { hexToBytes } from '@noble/hashes/utils';
import { HDKey } from '@scure/bip32';
import {
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  getCashuCryptography,
} from './cashu-crypto';

const seed = new Uint8Array(64).fill(7);
const crypto = getCashuCryptography(async () => seed);

describe('CashuCryptography', () => {
  it('getSeed returns the cashu seed', async () => {
    expect(await crypto.getSeed()).toBe(seed);
  });

  it('getXpub returns an extended public key at the locking base path', async () => {
    const xpub = await crypto.getXpub(BASE_CASHU_LOCKING_DERIVATION_PATH);
    expect(xpub.startsWith('xpub')).toBe(true);
  });

  it('private key at a path matches the public key the xpub derives at that path', async () => {
    const index = 4321;
    const priv = await crypto.getPrivateKey(
      `${BASE_CASHU_LOCKING_DERIVATION_PATH}/${index}`,
    );
    const pubFromPriv = secp256k1.getPublicKey(hexToBytes(priv), true);

    const baseXpub = await crypto.getXpub(BASE_CASHU_LOCKING_DERIVATION_PATH);
    const pubFromXpub =
      HDKey.fromExtendedKey(baseXpub).deriveChild(index).publicKey;
    if (!pubFromXpub) throw new Error('xpub-derived public key missing');

    expect(Buffer.from(pubFromPriv).toString('hex')).toBe(
      Buffer.from(pubFromXpub).toString('hex'),
    );
  });
});
