import { describe, expect, it, mock } from 'bun:test';
import * as actualInitWallet from '../internal/cashu/init-wallet';
import { NetworkError } from '@cashu/cashu-ts';
import { StoreWalletAccess } from './wallets';

const cashu = (over: Record<string, unknown> = {}) =>
  ({
    id: 'c1',
    type: 'cashu',
    currency: 'BTC',
    mintUrl: 'https://m/',
    isOnline: true,
    wallet: { tag: 'warm' },
    proofs: [],
    ...over,
  }) as any;
const spark = (over: Record<string, unknown> = {}) =>
  ({
    id: 's1',
    type: 'spark',
    currency: 'BTC',
    isOnline: true,
    wallet: { tag: 'spark' },
    ...over,
  }) as any;

const accountsStore = (accounts: any[]) =>
  ({
    get: () => accounts,
    toPromise: async () => accounts,
    subscribe: () => () => {},
    set: () => {},
  }) as any;
const runtime = () => ({ mintCache: { tag: 'mintCache' } }) as any;

describe('StoreWalletAccess', () => {
  it('getCashuAccount / getSparkAccount return residents from the store snapshot', () => {
    const c = cashu();
    const s = spark();
    const wa = new StoreWalletAccess(accountsStore([c, s]), runtime());
    expect(wa.getCashuAccount('c1')).toBe(c);
    expect(wa.getSparkAccount('s1')).toBe(s);
  });

  it('getCashuAccount throws on miss / wrong type', () => {
    const wa = new StoreWalletAccess(accountsStore([]), runtime());
    expect(() => wa.getCashuAccount('nope')).toThrow();
  });

  it('getSparkAccount throws on miss / wrong type', () => {
    const wa = new StoreWalletAccess(accountsStore([cashu()]), runtime());
    expect(() => wa.getSparkAccount('c1')).toThrow();
  });

  it('getCashuWalletByMint returns the resident wallet for matching mint+currency', () => {
    const c = cashu();
    const wa = new StoreWalletAccess(accountsStore([c]), runtime());
    expect(wa.getCashuWalletByMint('https://m/', 'BTC')).toBe(c.wallet);
  });

  it('getCashuWalletByMint matches mint urls that differ only by trailing slash', () => {
    const c = cashu();
    const wa = new StoreWalletAccess(accountsStore([c]), runtime());
    // resident mintUrl is 'https://m/'; query without the trailing slash.
    expect(wa.getCashuWalletByMint('https://m', 'BTC')).toBe(c.wallet);
  });

  it('getSourceCashuWallet rejects NetworkError when a resident mint is offline', async () => {
    const wa = new StoreWalletAccess(
      accountsStore([cashu({ isOnline: false })]),
      runtime(),
    );
    await expect(
      wa.getSourceCashuWallet('https://m/', 'BTC'),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('getSourceCashuWallet returns the resident wallet when online', async () => {
    const c = cashu();
    const wa = new StoreWalletAccess(accountsStore([c]), runtime());
    expect(await wa.getSourceCashuWallet('https://m/', 'BTC')).toBe(c.wallet);
  });
});

describe('StoreWalletAccess getSourceCashuWallet offline fallback', () => {
  it('rejects NetworkError when a non-resident mint is offline', async () => {
    mock.module('../internal/cashu/init-wallet', () => ({
      ...actualInitWallet,
      getInitializedCashuWallet: mock(async () => ({
        wallet: {},
        isOnline: false,
      })),
    }));
    const wa = new StoreWalletAccess(accountsStore([]), runtime());
    // No resident account at this mint -> falls back to getInitializedCashuWallet.
    await expect(
      wa.getSourceCashuWallet('https://offline/', 'BTC'),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});
