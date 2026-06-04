import { NetworkError } from '@cashu/cashu-ts';
import { describe, expect, test } from 'bun:test';
import { MintMetadataCache, getInitializedCashuWallet } from './cashu-wallet';

// -- A minimal fake cashu-ts `Mint` returning just enough for the online path ---------------

const MINT_URL = 'https://mint.example.com';

/** Minimal valid mint responses for a 'sat' (BTC) mint with one active keyset. */
function fakeMintResponses() {
  return {
    info: { name: 'Test', version: 'x', nuts: {} },
    keysets: {
      keysets: [{ id: '00abcd', unit: 'sat', active: true, input_fee_ppk: 0 }],
    },
    keys: {
      keysets: [
        {
          id: '00abcd',
          unit: 'sat',
          keys: { '1': `02${'a'.repeat(64)}`, '2': `02${'b'.repeat(64)}` },
        },
      ],
    },
  };
}

/** Build a fake `Mint`-shaped client; `calls` counts how many were constructed. */
function makeMintFactory(behaviour: 'online' | 'network-error' = 'online'): {
  createMint: (url: string) => never;
  calls: () => number;
} {
  let calls = 0;
  const r = fakeMintResponses();
  const createMint = (_url: string) => {
    calls++;
    if (behaviour === 'network-error') {
      const throwNet = () => {
        throw new NetworkError('offline');
      };
      return {
        getInfo: throwNet,
        getKeySets: throwNet,
        getKeys: throwNet,
      } as never;
    }
    return {
      getInfo: async () => r.info,
      getKeySets: async () => r.keysets,
      getKeys: async () => r.keys,
    } as never;
  };
  return { createMint, calls: () => calls };
}

describe('MintMetadataCache', () => {
  test('memoises within the TTL (one fetch for repeated gets)', async () => {
    const { createMint, calls } = makeMintFactory('online');
    const cache = new MintMetadataCache(() => 1000, createMint);

    await cache.get(MINT_URL);
    await cache.get(MINT_URL);

    expect(calls()).toBe(1);
  });

  test('refetches once the entry is older than the 1 h TTL', async () => {
    const { createMint, calls } = makeMintFactory('online');
    let now = 0;
    const cache = new MintMetadataCache(() => now, createMint);

    await cache.get(MINT_URL);
    now = 1000 * 60 * 60 + 1; // just past 1 h
    await cache.get(MINT_URL);

    expect(calls()).toBe(2);
  });

  test('does NOT cache a rejected fetch (next get retries)', async () => {
    let calls = 0;
    let mode: 'fail' | 'ok' = 'fail';
    const r = fakeMintResponses();
    const cache = new MintMetadataCache(
      () => 1000,
      (_url) => {
        calls++;
        if (mode === 'fail') {
          throw new NetworkError('boom');
        }
        return {
          getInfo: async () => r.info,
          getKeySets: async () => r.keysets,
          getKeys: async () => r.keys,
        } as never;
      },
    );

    await expect(cache.get(MINT_URL)).rejects.toBeInstanceOf(NetworkError);
    mode = 'ok';
    await expect(cache.get(MINT_URL)).resolves.toBeDefined();
    expect(calls).toBe(2);
  });
});

describe('getInitializedCashuWallet', () => {
  test('online: loads keys + reports isOnline true', async () => {
    const { createMint } = makeMintFactory('online');
    const cache = new MintMetadataCache(() => 1000, createMint);

    const { wallet, isOnline } = await getInitializedCashuWallet({
      cache,
      mintUrl: MINT_URL,
      currency: 'BTC',
    });

    expect(isOnline).toBe(true);
    expect(wallet.unit).toBe('sat');
    expect(wallet.mint.mintUrl).toBe(MINT_URL);
  });

  test('offline (NetworkError): returns a wallet with isOnline false', async () => {
    const { createMint } = makeMintFactory('network-error');
    const cache = new MintMetadataCache(() => 1000, createMint);

    const { wallet, isOnline } = await getInitializedCashuWallet({
      cache,
      mintUrl: MINT_URL,
      currency: 'BTC',
    });

    expect(isOnline).toBe(false);
    // The wallet is still constructed (offline-tolerant), just without loaded keys.
    expect(wallet.unit).toBe('sat');
  });

  test('reachable mint with no active keyset for the currency throws', async () => {
    const cache = new MintMetadataCache(
      () => 1000,
      (_url) =>
        ({
          getInfo: async () => ({ name: 'T', version: 'x', nuts: {} }),
          // only an INACTIVE keyset → no active keyset for sat
          getKeySets: async () => ({
            keysets: [
              { id: '00ff', unit: 'sat', active: false, input_fee_ppk: 0 },
            ],
          }),
          getKeys: async () => ({ keysets: [] }),
        }) as never,
    );

    await expect(
      getInitializedCashuWallet({ cache, mintUrl: MINT_URL, currency: 'BTC' }),
    ).rejects.toThrow('No active keyset');
  });
});
