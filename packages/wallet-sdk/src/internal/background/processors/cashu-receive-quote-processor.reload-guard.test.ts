import { describe, expect, mock, spyOn, test } from 'bun:test';
import type { CashuReceiveQuote } from '../../../domains/cashu-receive-quote';
import type { WalletAccess } from '../../../engine';
import { MeltQuoteTracker } from '../../cashu/melt-quote-tracker';
import { MintQuoteTracker } from '../../cashu/mint-quote-tracker';
import {
  CashuReceiveQuoteProcessor,
  type CashuReceiveQuoteProcessorDeps,
} from './cashu-receive-quote-processor';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const quote = (): CashuReceiveQuote =>
  ({
    id: 'q1',
    quoteId: 'mint-q1',
    accountId: 'acc1',
    type: 'LIGHTNING',
    state: 'UNPAID',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }) as unknown as CashuReceiveQuote;

const makeProcessor = (
  fetchWorkSet: (userId: string) => Promise<CashuReceiveQuote[]>,
) => {
  const wallets = {
    getCashuAccount: mock(() => ({
      mintUrl: 'https://mint.test',
      currency: 'BTC',
      wallet: {},
    })),
    getCashuWalletByMint: mock(() => ({})),
  } as unknown as WalletAccess;

  const deps = {
    service: {} as CashuReceiveQuoteProcessorDeps['service'],
    runner: {} as CashuReceiveQuoteProcessorDeps['runner'],
    wallets,
    fetchWorkSet,
  } satisfies CashuReceiveQuoteProcessorDeps;

  return new CashuReceiveQuoteProcessor(deps);
};

describe('CashuReceiveQuoteProcessor reload guard', () => {
  test('drops a reload whose work-set resolves after the epoch moved', async () => {
    const mintUpdate = spyOn(
      MintQuoteTracker.prototype,
      'update',
    ).mockImplementation(() => {});
    const meltUpdate = spyOn(
      MeltQuoteTracker.prototype,
      'update',
    ).mockImplementation(() => {});
    try {
      const work = deferred<CashuReceiveQuote[]>();
      const processor = makeProcessor(() => work.promise);

      let current = true;
      const isCurrent = () => current;

      const reloadPromise = processor.reload('u1', isCurrent);

      // Leadership flips while fetchWorkSet is in flight.
      current = false;
      work.resolve([quote()]);
      await reloadPromise;

      expect(mintUpdate).not.toHaveBeenCalled();
      expect(meltUpdate).not.toHaveBeenCalled();
    } finally {
      mintUpdate.mockRestore();
      meltUpdate.mockRestore();
    }
  });

  test('arms the trackers when leadership holds through the fetch', async () => {
    const mintUpdate = spyOn(
      MintQuoteTracker.prototype,
      'update',
    ).mockImplementation(() => {});
    const meltUpdate = spyOn(
      MeltQuoteTracker.prototype,
      'update',
    ).mockImplementation(() => {});
    try {
      const work = deferred<CashuReceiveQuote[]>();
      const processor = makeProcessor(() => work.promise);

      const reloadPromise = processor.reload('u1', () => true);
      work.resolve([quote()]);
      await reloadPromise;

      expect(mintUpdate).toHaveBeenCalledTimes(1);
    } finally {
      mintUpdate.mockRestore();
      meltUpdate.mockRestore();
    }
  });
});
