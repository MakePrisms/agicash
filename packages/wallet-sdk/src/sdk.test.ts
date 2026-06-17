import { describe, expect, it } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { QueryClient } from '@tanstack/query-core';
import { createLazyEncryption } from './encryption';
import { WalletSdk } from './sdk';

describe('WalletSdk.getInstance', () => {
  // The client-only guard lives in the web's useSdk() hook; the accessor itself
  // is host-agnostic and only requires prior configuration.
  it('throws when the SDK is not configured', () => {
    expect(() => WalletSdk.getInstance()).toThrow('not configured');
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
