import { describe, expect, it } from 'bun:test';
import type { ExtendedCashuWallet } from '@agicash/cashu';
import { flush } from '../domain/wallet/task-saga-test-kit';
import { nullLogger } from './logger';
import { MeltQuoteSubscriptionManager } from './melt-quote-subscription-manager';
import { MintQuoteSubscriptionManager } from './mint-quote-subscription-manager';

type FakeSubscription = {
  callback: (update: unknown) => void;
  resolve: () => void;
  unsubscribeCalls: () => number;
  closeHandlers: Array<(event: unknown) => void>;
};

function createFakeWallets(method: 'mintQuoteUpdates' | 'meltQuoteUpdates') {
  const subscriptions: FakeSubscription[] = [];
  const getWallet = (_mintUrl: string) => {
    const closeHandlers: Array<(event: unknown) => void> = [];
    const wallet = {
      on: {
        [method]: (_ids: string[], callback: (update: unknown) => void) =>
          new Promise<() => void>((resolve) => {
            let unsubscribeCalls = 0;
            const unsubscribe = () => {
              unsubscribeCalls += 1;
            };
            subscriptions.push({
              callback,
              resolve: () => resolve(unsubscribe),
              unsubscribeCalls: () => unsubscribeCalls,
              closeHandlers,
            });
          }),
      },
      mint: {
        webSocketConnection: {
          onClose: (handler: (event: unknown) => void) => {
            closeHandlers.push(handler);
          },
        },
      },
    };
    return wallet as unknown as ExtendedCashuWallet;
  };
  return { subscriptions, getWallet };
}

type QuoteManager = {
  subscribe(params: {
    mintUrl: string;
    quoteIds: string[];
    onUpdate: (quote: never) => void;
  }): Promise<() => void>;
  unsubscribeAll(): void;
};

const variants: Array<{
  name: string;
  method: 'mintQuoteUpdates' | 'meltQuoteUpdates';
  create: (getWallet: (mintUrl: string) => ExtendedCashuWallet) => QuoteManager;
}> = [
  {
    name: 'MintQuoteSubscriptionManager',
    method: 'mintQuoteUpdates',
    create: (getWallet) =>
      new MintQuoteSubscriptionManager(nullLogger, { getWallet }),
  },
  {
    name: 'MeltQuoteSubscriptionManager',
    method: 'meltQuoteUpdates',
    create: (getWallet) =>
      new MeltQuoteSubscriptionManager(nullLogger, { getWallet }),
  },
];

const mintUrl = 'https://mint-a.example';

function recorder() {
  const updates: unknown[] = [];
  return { updates, onUpdate: (quote: unknown) => updates.push(quote) };
}

for (const variant of variants) {
  describe(variant.name, () => {
    it('unsubscribeAll during a pending subscribe leaves no entry and unsubscribes the late subscription', async () => {
      const wallets = createFakeWallets(variant.method);
      const manager = variant.create(wallets.getWallet);

      const pendingA = manager.subscribe({
        mintUrl,
        quoteIds: ['q1'],
        onUpdate: recorder().onUpdate,
      });
      manager.unsubscribeAll();
      wallets.subscriptions[0]?.resolve();
      const unsubscribeA = await pendingA;
      expect(wallets.subscriptions[0]?.unsubscribeCalls()).toBeGreaterThan(0);

      const b = recorder();
      const pendingB = manager.subscribe({
        mintUrl,
        quoteIds: ['q1'],
        onUpdate: b.onUpdate,
      });
      expect(wallets.subscriptions).toHaveLength(2);
      wallets.subscriptions[1]?.resolve();
      await pendingB;

      for (const handler of wallets.subscriptions[0]?.closeHandlers ?? []) {
        handler({});
      }
      unsubscribeA();

      const update = { quote: 'q1', state: 'PAID' };
      wallets.subscriptions[1]?.callback(update);
      expect(b.updates).toEqual([update]);
    });

    it('a subscribe that waited on a removed entry subscribes fresh', async () => {
      const wallets = createFakeWallets(variant.method);
      const manager = variant.create(wallets.getWallet);

      const pendingA = manager.subscribe({
        mintUrl,
        quoteIds: ['q1'],
        onUpdate: recorder().onUpdate,
      });
      wallets.subscriptions[0]?.resolve();
      const unsubscribeA = await pendingA;

      const b = recorder();
      const pendingB = manager.subscribe({
        mintUrl,
        quoteIds: ['q1'],
        onUpdate: b.onUpdate,
      });
      unsubscribeA();
      await flush();

      expect(wallets.subscriptions).toHaveLength(2);
      wallets.subscriptions[1]?.resolve();
      await pendingB;

      const update = { quote: 'q1', state: 'PAID' };
      wallets.subscriptions[1]?.callback(update);
      expect(b.updates).toEqual([update]);
    });
  });
}
