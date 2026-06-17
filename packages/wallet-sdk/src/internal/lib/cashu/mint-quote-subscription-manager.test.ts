import { describe, expect, it, mock } from 'bun:test';
import type { MintQuoteBolt11Response } from '@cashu/cashu-ts';
import type { ExtendedCashuWallet } from './utils';
import { MintQuoteSubscriptionManager } from './mint-quote-subscription-manager';

function fakeWallet() {
  const captured: { ids: string[]; cb: (q: MintQuoteBolt11Response) => void }[] = [];
  const wallet = {
    on: {
      mintQuoteUpdates: mock(
        async (
          ids: string[],
          cb: (q: MintQuoteBolt11Response) => void,
          _onErr: (e: unknown) => void,
        ) => {
          captured.push({ ids, cb });
          return mock(() => {});
        },
      ),
    },
    mint: { webSocketConnection: { onClose: mock(() => {}) } },
  } as unknown as ExtendedCashuWallet;
  return { wallet, captured };
}

describe('MintQuoteSubscriptionManager', () => {
  it('opens one WS per mint and relays mint-quote updates', async () => {
    const { wallet, captured } = fakeWallet();
    const manager = new MintQuoteSubscriptionManager(async () => wallet);
    const seen: string[] = [];
    await manager.subscribe({
      mintUrl: 'm',
      quoteIds: ['q1'],
      onUpdate: (q) => seen.push(q.quote),
    });
    captured[0]?.cb({ quote: 'q1', state: 'PAID' } as MintQuoteBolt11Response);
    expect(seen).toEqual(['q1']);
  });

  it('reuses the socket when the new ids are a subset', async () => {
    const { wallet } = fakeWallet();
    const manager = new MintQuoteSubscriptionManager(async () => wallet);
    await manager.subscribe({ mintUrl: 'm', quoteIds: ['q1', 'q2'], onUpdate: () => {} });
    await manager.subscribe({ mintUrl: 'm', quoteIds: ['q1'], onUpdate: () => {} });
    expect(wallet.on.mintQuoteUpdates).toHaveBeenCalledTimes(1);
  });
});
