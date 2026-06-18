import { describe, expect, it, mock } from 'bun:test';
import * as actualInitWallet from '../internal/cashu/init-wallet';
import { NetworkError } from '@cashu/cashu-ts';
import { ResidentAccounts } from './resident-accounts';

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

const makeRuntime = (accounts: any[] = []) =>
  ({
    accountRepository: { getAllActive: mock(async () => accounts) },
    mintCache: { tag: 'mintCache' },
    mintAuth: { tag: 'mintAuth' },
  }) as any;

describe('ResidentAccounts', () => {
  it('ensureLoaded fills the map; getCashuAccount/getSparkAccount return residents', async () => {
    const c = cashu();
    const s = spark();
    const ra = new ResidentAccounts(makeRuntime([c, s]));
    await ra.ensureLoaded('u1');
    expect(ra.getCashuAccount('c1')).toBe(c);
    expect(ra.getSparkAccount('s1')).toBe(s);
  });

  it('getCashuAccount throws on a missing/non-resident account', async () => {
    const ra = new ResidentAccounts(makeRuntime([]));
    await ra.ensureLoaded('u1');
    expect(() => ra.getCashuAccount('nope')).toThrow();
  });

  it('getSparkAccount throws on a missing/non-resident account', async () => {
    const ra = new ResidentAccounts(makeRuntime([cashu()]));
    await ra.ensureLoaded('u1');
    expect(() => ra.getSparkAccount('c1')).toThrow();
  });

  it('isOnline is tolerant: false for a missing account, reflects the resident flag', async () => {
    const ra = new ResidentAccounts(
      makeRuntime([cashu({ id: 'c1', isOnline: false })]),
    );
    await ra.ensureLoaded('u1');
    expect(ra.isOnline('c1')).toBe(false);
    expect(ra.isOnline('missing')).toBe(false);
  });

  it('isOnline returns true for an online resident', async () => {
    const ra = new ResidentAccounts(makeRuntime([cashu()]));
    await ra.ensureLoaded('u1');
    expect(ra.isOnline('c1')).toBe(true);
  });

  it('upsert refreshes a resident entry', async () => {
    const ra = new ResidentAccounts(makeRuntime([cashu()]));
    await ra.ensureLoaded('u1');
    const next = cashu({ wallet: { tag: 'fresh' } });
    ra.upsert(next);
    expect(ra.getCashuAccount('c1')).toBe(next);
  });

  it('all() returns every resident account', async () => {
    const c = cashu();
    const s = spark();
    const ra = new ResidentAccounts(makeRuntime([c, s]));
    await ra.ensureLoaded('u1');
    expect(ra.all()).toEqual([c, s]);
  });

  it('getCashuWalletByMint returns the resident wallet for a matching mint+currency', async () => {
    const c = cashu();
    const ra = new ResidentAccounts(makeRuntime([c]));
    await ra.ensureLoaded('u1');
    expect(ra.getCashuWalletByMint('https://m/', 'BTC')).toBe(c.wallet);
  });

  it('getCashuWalletByMint matches mint urls that differ only by trailing slash', async () => {
    const c = cashu();
    const ra = new ResidentAccounts(makeRuntime([c]));
    await ra.ensureLoaded('u1');
    // resident mintUrl is 'https://m/'; query without the trailing slash.
    expect(ra.getCashuWalletByMint('https://m', 'BTC')).toBe(c.wallet);
  });

  it('reloadLast re-invokes getAllActive for the last loaded userId', async () => {
    const runtime = makeRuntime([cashu()]);
    const ra = new ResidentAccounts(runtime);
    await ra.ensureLoaded('u1');
    expect(runtime.accountRepository.getAllActive).toHaveBeenCalledTimes(1);
    await ra.reloadLast();
    expect(runtime.accountRepository.getAllActive).toHaveBeenCalledTimes(2);
    expect(runtime.accountRepository.getAllActive).toHaveBeenLastCalledWith(
      'u1',
    );
  });

  it('reloadLast is a safe no-op before any load', async () => {
    const runtime = makeRuntime([cashu()]);
    const ra = new ResidentAccounts(runtime);
    await ra.reloadLast();
    expect(runtime.accountRepository.getAllActive).not.toHaveBeenCalled();
  });

  it('getSourceCashuWallet rejects NetworkError when a resident mint is offline', async () => {
    const ra = new ResidentAccounts(makeRuntime([cashu({ isOnline: false })]));
    await ra.ensureLoaded('u1');
    await expect(
      ra.getSourceCashuWallet('https://m/', 'BTC'),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('getSourceCashuWallet returns the resident wallet when online', async () => {
    const c = cashu();
    const ra = new ResidentAccounts(makeRuntime([c]));
    await ra.ensureLoaded('u1');
    expect(await ra.getSourceCashuWallet('https://m/', 'BTC')).toBe(c.wallet);
  });
});

describe('ResidentAccounts getSourceCashuWallet offline fallback', () => {
  it('rejects NetworkError when a non-resident mint is offline', async () => {
    mock.module('../internal/cashu/init-wallet', () => ({
      ...actualInitWallet,
      getInitializedCashuWallet: mock(async () => ({
        wallet: {},
        isOnline: false,
      })),
    }));
    const ra = new ResidentAccounts(makeRuntime([]));
    await ra.ensureLoaded('u1');
    // No resident account at this mint -> falls back to getInitializedCashuWallet.
    await expect(
      ra.getSourceCashuWallet('https://offline/', 'BTC'),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});
