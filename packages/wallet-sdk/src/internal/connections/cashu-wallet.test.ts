import { describe, expect, it } from 'bun:test';
import { NetworkError } from '@cashu/cashu-ts';
import { CashuWalletService } from './cashu-wallet';

describe('CashuWalletService', () => {
  it('returns an offline wallet on NetworkError (and does not cache the failure)', async () => {
    let calls = 0;
    const svc = new CashuWalletService(async () => {
      calls += 1;
      throw new NetworkError('down');
    });
    const a = await svc.getInitialized(
      'https://mint.test',
      'BTC',
      undefined,
      undefined,
    );
    expect(a.isOnline).toBe(false);
    expect(a.wallet).toBeDefined();
    await svc.getInitialized('https://mint.test', 'BTC', undefined, undefined);
    expect(calls).toBe(2); // failed fetch not memoized → retried
  });

  it('memoizes successful metadata per mint URL', async () => {
    let calls = 0;
    const meta = {
      mintInfo: { cache: {} },
      keysets: { keysets: [{ id: 'ks1', unit: 'sat', active: true }] },
      keys: { keysets: [{ id: 'ks1', unit: 'sat', keys: {} }] },
    } as never;
    const svc = new CashuWalletService(async () => {
      calls += 1;
      return meta;
    });
    // Two calls for the same mint should fetch metadata once. The online branch
    // builds a real ExtendedCashuWallet + loadMintFromCache; if the fake cache
    // shape is too thin for loadMintFromCache, wrap each call in try/catch and
    // assert on `calls` only (the memo is the unit under test here).
    await svc
      .getInitialized('https://m.test', 'BTC', undefined, undefined)
      .catch(() => undefined);
    await svc
      .getInitialized('https://m.test', 'BTC', undefined, undefined)
      .catch(() => undefined);
    expect(calls).toBe(1);
  });
});
