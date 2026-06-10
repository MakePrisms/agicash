import { describe, expect, it } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { QueryClient } from '@tanstack/query-core';
import { createLazyEncryption, getSdk } from './sdk';

describe('getSdk', () => {
  // bun test runs with no `window`, so isServer is true.
  it('throws in a server context', () => {
    expect(() => getSdk()).toThrow('client-only');
  });
});

describe('createLazyEncryption', () => {
  it('resolves keys through the query cache and round-trips data', async () => {
    const privateKey = secp256k1.utils.randomSecretKey();
    const publicKeyHex = bytesToHex(
      secp256k1.Point.BASE.multiply(
        secp256k1.Point.Fn.fromBytes(privateKey),
      ).toRawBytes(true),
    );

    // Seed the key queries; staleTime is Infinity so fetchQuery serves these
    // without hitting the OpenSecret-backed queryFn.
    const queryClient = new QueryClient();
    queryClient.setQueryData(['encryption-private-key'], privateKey);
    queryClient.setQueryData(['encryption-public-key'], publicKeyHex);

    const encryption = createLazyEncryption(queryClient);
    const data = { hello: 'lazy', n: 7 };
    const decrypted = await encryption.decrypt(await encryption.encrypt(data));
    expect(decrypted).toEqual(data);
  });
});
