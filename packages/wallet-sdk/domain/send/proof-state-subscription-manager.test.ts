import { describe, expect, it } from 'bun:test';
import type { ExtendedCashuWallet } from '@agicash/cashu';
import { nullLogger } from '../../lib/logger';
import { flush } from '../wallet/task-saga-test-kit';
import type { CashuSendSwap, PendingCashuSendSwap } from './cashu-send-swap';
import { ProofStateSubscriptionManager } from './proof-state-subscription-manager';

type FakeSubscription = {
  callback: (update: unknown) => void;
  resolve: () => void;
  unsubscribeCalls: () => number;
  closeHandlers: Array<(event: unknown) => void>;
};

function createFakeWallets() {
  const subscriptions: FakeSubscription[] = [];
  const getWallet = (_mintUrl: string) => {
    const closeHandlers: Array<(event: unknown) => void> = [];
    const wallet = {
      on: {
        proofStateUpdates: (
          _proofs: unknown[],
          callback: (update: unknown) => void,
        ) =>
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

const mintUrl = 'https://mint-a.example';

const swap = {
  id: 'swap-1',
  proofsToSend: [
    {
      keysetId: 'keyset-1',
      amount: 1,
      secret: 'secret-1',
      unblindedSignature: 'C1',
    },
  ],
} as unknown as PendingCashuSendSwap;

const spentUpdate = { Y: 'Y1', state: 'SPENT', proof: { C: 'C1' } };

function recorder() {
  const spent: CashuSendSwap[] = [];
  return {
    spent,
    onSpent: (spentSwap: CashuSendSwap) => spent.push(spentSwap),
  };
}

describe('ProofStateSubscriptionManager', () => {
  it('unsubscribeAll during a pending subscribe leaves no entry and unsubscribes the late subscription', async () => {
    const wallets = createFakeWallets();
    const manager = new ProofStateSubscriptionManager(nullLogger, {
      getWallet: wallets.getWallet,
    });

    const pendingA = manager.subscribe({
      mintUrl,
      swaps: [swap],
      onSpent: recorder().onSpent,
    });
    manager.unsubscribeAll();
    wallets.subscriptions[0]?.resolve();
    const unsubscribeA = await pendingA;
    expect(wallets.subscriptions[0]?.unsubscribeCalls()).toBeGreaterThan(0);

    const b = recorder();
    const pendingB = manager.subscribe({
      mintUrl,
      swaps: [swap],
      onSpent: b.onSpent,
    });
    expect(wallets.subscriptions).toHaveLength(2);
    wallets.subscriptions[1]?.resolve();
    await pendingB;

    for (const handler of wallets.subscriptions[0]?.closeHandlers ?? []) {
      handler({});
    }
    unsubscribeA();

    wallets.subscriptions[1]?.callback(spentUpdate);
    expect(b.spent).toEqual([swap]);
  });

  it('a subscribe that waited on a removed entry subscribes fresh', async () => {
    const wallets = createFakeWallets();
    const manager = new ProofStateSubscriptionManager(nullLogger, {
      getWallet: wallets.getWallet,
    });

    const pendingA = manager.subscribe({
      mintUrl,
      swaps: [swap],
      onSpent: recorder().onSpent,
    });
    wallets.subscriptions[0]?.resolve();
    const unsubscribeA = await pendingA;

    const b = recorder();
    const pendingB = manager.subscribe({
      mintUrl,
      swaps: [swap],
      onSpent: b.onSpent,
    });
    unsubscribeA();
    await flush();

    expect(wallets.subscriptions).toHaveLength(2);
    wallets.subscriptions[1]?.resolve();
    await pendingB;

    wallets.subscriptions[1]?.callback(spentUpdate);
    expect(b.spent).toEqual([swap]);
  });
});
