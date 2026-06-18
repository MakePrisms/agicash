import { describe, expect, it, mock } from 'bun:test';
import type { MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import { MeltQuoteSubscriptionManager } from './melt-quote-subscription-manager';
import type { ExtendedCashuWallet } from './utils';

type Captured = {
  ids: string[];
  cb: (q: MeltQuoteBolt11Response) => void;
};

function fakeWallet() {
  const captured: Captured[] = [];
  const unsubscribe = mock(() => undefined);
  const wallet = {
    on: {
      meltQuoteUpdates: mock(
        async (
          ids: string[],
          cb: (q: MeltQuoteBolt11Response) => void,
          _onErr: (e: unknown) => void,
        ) => {
          captured.push({ ids, cb });
          return unsubscribe;
        },
      ),
    },
    mint: { webSocketConnection: { onClose: mock(() => undefined) } },
  } as unknown as ExtendedCashuWallet;
  return { wallet, captured, unsubscribe };
}

describe('MeltQuoteSubscriptionManager', () => {
  it('opens one WS for the mint and relays updates to onUpdate', async () => {
    const { wallet, captured } = fakeWallet();
    const getWallet = mock(async (_mintUrl: string) => wallet);
    const manager = new MeltQuoteSubscriptionManager(getWallet);

    const updates: string[] = [];
    await manager.subscribe({
      mintUrl: 'https://mint.test',
      quoteIds: ['q1', 'q2'],
      onUpdate: (q) => updates.push(q.quote),
    });

    expect(getWallet).toHaveBeenCalledWith('https://mint.test');
    expect(captured[0]?.ids).toEqual(['q1', 'q2']);

    captured[0]?.cb({ quote: 'q1', state: 'PAID' } as MeltQuoteBolt11Response);
    expect(updates).toEqual(['q1']);
  });

  it('reuses the WS and swaps the callback when the new ids are a subset', async () => {
    const { wallet, captured } = fakeWallet();
    const getWallet = mock(async () => wallet);
    const manager = new MeltQuoteSubscriptionManager(getWallet);

    await manager.subscribe({
      mintUrl: 'm',
      quoteIds: ['q1', 'q2'],
      onUpdate: () => undefined,
    });
    const seen: string[] = [];
    await manager.subscribe({
      mintUrl: 'm',
      quoteIds: ['q1'],
      onUpdate: (q) => seen.push(q.quote),
    });

    expect(wallet.on.meltQuoteUpdates).toHaveBeenCalledTimes(1); // no re-open
    captured[0]?.cb({ quote: 'q1', state: 'PAID' } as MeltQuoteBolt11Response);
    expect(seen).toEqual(['q1']); // latest callback used
  });

  it('removeQuoteFromSubscription drops one id without unsubscribing', async () => {
    const { wallet, unsubscribe } = fakeWallet();
    const manager = new MeltQuoteSubscriptionManager(async () => wallet);
    await manager.subscribe({
      mintUrl: 'm',
      quoteIds: ['q1', 'q2'],
      onUpdate: () => undefined,
    });
    manager.removeQuoteFromSubscription({ mintUrl: 'm', quoteId: 'q1' });
    expect(unsubscribe).not.toHaveBeenCalled();
  });
});
