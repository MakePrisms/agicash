import { describe, expect, it, mock } from 'bun:test';
import { ProofStateSubscriptionManager } from './proof-state-subscription-manager';

const MINT_URL = 'https://mint.test';

describe('ProofStateSubscriptionManager.disposeAll', () => {
  it('runs the registered unsubscribe fn and clears the map', async () => {
    const unsub = mock(async () => {});
    const mgr = new ProofStateSubscriptionManager();

    // @ts-expect-error — access private subscriptions for test setup
    mgr.subscriptions.set(MINT_URL, {
      ids: new Set(['swap1']),
      subscriptionPromise: Promise.resolve(unsub as () => void),
      onSpent: () => {},
    });

    await mgr.disposeAll();

    expect(unsub).toHaveBeenCalledTimes(1);
    expect(mgr.activeMintCount).toBe(0);
  });

  it('is a no-op when there are no subscriptions', async () => {
    const mgr = new ProofStateSubscriptionManager();
    await expect(mgr.disposeAll()).resolves.toBeUndefined();
    expect(mgr.activeMintCount).toBe(0);
  });
});
