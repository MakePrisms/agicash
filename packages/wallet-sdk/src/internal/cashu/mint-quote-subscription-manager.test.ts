import { describe, expect, it, mock } from 'bun:test';
import { MintQuoteSubscriptionManager } from './mint-quote-subscription-manager';

const makeFakeWallet = (unsub: () => Promise<void>) => ({
  on: {
    mintQuoteUpdates: mock(
      async (
        _ids: string[],
        _onUpdate: unknown,
        _onError: unknown,
      ): Promise<() => void> => unsub,
    ),
  },
  mint: { webSocketConnection: undefined },
});

// Override getCashuWallet for this test file
const MINT_URL = 'https://mint.test';

describe('MintQuoteSubscriptionManager.disposeAll', () => {
  it('runs the registered unsubscribe fn and clears the map', async () => {
    const unsub = mock(async () => {});
    const mgr = new MintQuoteSubscriptionManager();

    // Seed a subscription by injecting a resolved subscriptionPromise into the map
    const subscriptionPromise = Promise.resolve(unsub as () => void);
    // @ts-expect-error — access private subscriptions for test setup
    mgr.subscriptions.set(MINT_URL, {
      ids: new Set(['q1']),
      subscriptionPromise,
      onUpdate: () => {},
    });

    await mgr.disposeAll();

    expect(unsub).toHaveBeenCalledTimes(1);
    expect(mgr.activeMintCount).toBe(0);
  });

  it('handles multiple subscriptions, clears all', async () => {
    const unsub1 = mock(async () => {});
    const unsub2 = mock(async () => {});
    const mgr = new MintQuoteSubscriptionManager();

    // @ts-expect-error — access private subscriptions for test setup
    mgr.subscriptions.set('https://mint1.test', {
      ids: new Set(['q1']),
      subscriptionPromise: Promise.resolve(unsub1 as () => void),
      onUpdate: () => {},
    });
    // @ts-expect-error — access private subscriptions for test setup
    mgr.subscriptions.set('https://mint2.test', {
      ids: new Set(['q2']),
      subscriptionPromise: Promise.resolve(unsub2 as () => void),
      onUpdate: () => {},
    });

    await mgr.disposeAll();

    expect(unsub1).toHaveBeenCalledTimes(1);
    expect(unsub2).toHaveBeenCalledTimes(1);
    expect(mgr.activeMintCount).toBe(0);
  });

  it('is a no-op when there are no subscriptions', async () => {
    const mgr = new MintQuoteSubscriptionManager();
    await expect(mgr.disposeAll()).resolves.toBeUndefined();
    expect(mgr.activeMintCount).toBe(0);
  });
});
