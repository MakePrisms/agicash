import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Proof, ProofState } from '@cashu/cashu-ts';
import type { PendingCashuSendSwap } from './cashu-send-swap';
import { ProofStateSubscriptionManager } from './proof-state-subscription-manager';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const MINT_URL = 'https://mint.example';

const pendingSwap = (
  overrides: Partial<PendingCashuSendSwap> = {},
): PendingCashuSendSwap =>
  ({
    id: 'swap-1',
    accountId: 'account-1',
    state: 'PENDING',
    proofsToSend: [{ unblindedSignature: 'C-1' }],
    ...overrides,
  }) as unknown as PendingCashuSendSwap;

type ProofUpdateListener = (update: ProofState & { proof: Proof }) => void;

/**
 * A fake getCashuWallet that records each proofStateUpdates subscription and
 * lets the test drive proof-state updates and assert (un)subscribe calls.
 */
const createWalletHarness = () => {
  const unsubscribe = mock(() => undefined);
  const proofStateUpdates = mock(
    async (_proofs, listener: ProofUpdateListener) => {
      harness.listeners.push(listener);
      return unsubscribe;
    },
  );
  const harness = {
    unsubscribe,
    proofStateUpdates,
    listeners: [] as ProofUpdateListener[],
    getWallet: (() => ({
      on: { proofStateUpdates },
      mint: { webSocketConnection: { onClose: () => undefined } },
    })) as unknown as ConstructorParameters<
      typeof ProofStateSubscriptionManager
    >[0],
    emitSpent: (proofC: string) => {
      for (const listener of harness.listeners) {
        listener({ proof: { C: proofC }, state: 'SPENT' } as ProofState & {
          proof: Proof;
        });
      }
    },
  };
  return harness;
};

describe('ProofStateSubscriptionManager', () => {
  let wallet: ReturnType<typeof createWalletHarness>;
  let manager: ProofStateSubscriptionManager;

  beforeEach(() => {
    wallet = createWalletHarness();
    manager = new ProofStateSubscriptionManager(wallet.getWallet);
  });

  it('subscribes a socket for a new mint', async () => {
    await manager.subscribe({
      mintUrl: MINT_URL,
      swaps: [pendingSwap()],
      onSpent: () => undefined,
    });

    expect(wallet.proofStateUpdates).toHaveBeenCalledTimes(1);
  });

  it('reuses the open socket for a subset re-subscribe (does not re-subscribe)', async () => {
    const args = {
      mintUrl: MINT_URL,
      swaps: [pendingSwap()],
      onSpent: () => undefined,
    };
    await manager.subscribe(args);
    await manager.subscribe(args);

    expect(wallet.proofStateUpdates).toHaveBeenCalledTimes(1);
  });

  describe('unsubscribeAll', () => {
    it('closes the open sockets', async () => {
      await manager.subscribe({
        mintUrl: MINT_URL,
        swaps: [pendingSwap()],
        onSpent: () => undefined,
      });

      manager.unsubscribeAll();
      await flush();

      expect(wallet.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('stops a late socket event from firing onSpent', async () => {
      const onSpent = mock(() => undefined);
      await manager.subscribe({
        mintUrl: MINT_URL,
        swaps: [pendingSwap()],
        onSpent,
      });

      manager.unsubscribeAll();
      // A socket the mint has not closed yet delivers the final spent update.
      wallet.emitSpent('C-1');
      await flush();

      expect(onSpent).not.toHaveBeenCalled();
    });

    it('re-subscribes fresh after teardown (so the mint re-delivers state)', async () => {
      const args = {
        mintUrl: MINT_URL,
        swaps: [pendingSwap()],
        onSpent: () => undefined,
      };
      await manager.subscribe(args);
      expect(wallet.proofStateUpdates).toHaveBeenCalledTimes(1);

      manager.unsubscribeAll();
      await manager.subscribe(args);

      // Without teardown this would subset-reuse and stay at 1; the fresh
      // subscription is what lets the mint re-deliver the current proof state.
      expect(wallet.proofStateUpdates).toHaveBeenCalledTimes(2);
    });

    it('clears accumulated partial proof state', async () => {
      const onSpent = mock(() => undefined);
      const swap = pendingSwap({
        proofsToSend: [
          { unblindedSignature: 'C-1' },
          { unblindedSignature: 'C-2' },
        ],
      } as Partial<PendingCashuSendSwap>);
      await manager.subscribe({ mintUrl: MINT_URL, swaps: [swap], onSpent });

      // Only the first of two proofs is spent: a partial, not-yet-complete state.
      wallet.emitSpent('C-1');
      await flush();
      expect(onSpent).not.toHaveBeenCalled();

      // Teardown must drop the partial accumulator; re-subscribe fresh and spend
      // the same first proof again — if the partial survived, the second proof
      // alone would wrongly look "all spent".
      manager.unsubscribeAll();
      await manager.subscribe({ mintUrl: MINT_URL, swaps: [swap], onSpent });
      wallet.emitSpent('C-2');
      await flush();

      expect(onSpent).not.toHaveBeenCalled();
    });
  });
});
