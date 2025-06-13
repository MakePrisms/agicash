import type { Proof, ProofState } from '@cashu/cashu-ts';
import { getCashuWallet } from '~/lib/cashu';
import { isSubset } from '~/lib/utils';
import type { CashuSendSwap, PendingCashuSendSwap } from './cashu-send-swap';

type Subscription = {
  ids: Set<string>;
  subscriptionPromise: Promise<() => void>;
  onSpent: (swap: CashuSendSwap) => void;
};

export class ProofStateSubscriptionManager {
  private subscriptions: Map<string, Subscription> = new Map();
  private proofUpdates: Record<string, Record<string, ProofState['state']>> =
    {};

  async subscribe({
    mintUrl,
    swaps,
    onSpent,
  }: {
    mintUrl: string;
    swaps: PendingCashuSendSwap[];
    onSpent: (swap: CashuSendSwap) => void;
  }): Promise<void> {
    const ids = new Set(swaps.map((x) => x.id));
    const mintSubscription = this.subscriptions.get(mintUrl);

    if (mintSubscription) {
      await mintSubscription.subscriptionPromise;

      if (isSubset(ids, mintSubscription.ids)) {
        this.subscriptions.set(mintUrl, {
          ...mintSubscription,
          onSpent,
        });
        console.debug(
          'Proof state updates subscription already exists for mint. Updated callback.',
          mintUrl,
          swaps,
        );
        return;
      }

      const unsubscribe = await mintSubscription.subscriptionPromise;

      console.debug('Unsubscribing from proof state updates for mint', mintUrl);
      unsubscribe();
    }

    const wallet = getCashuWallet(mintUrl);

    console.debug('Subscribing to proof state updates for mint', {
      mintUrl,
      swaps,
    });

    const subscriptionCallback = (
      proofUpdate: ProofState & { proof: Proof },
    ) => {
      const currentSubscription = this.subscriptions.get(mintUrl);
      if (currentSubscription) {
        this.handleProofStateUpdate(
          proofUpdate,
          swaps,
          currentSubscription.onSpent,
        );
      }
    };

    const subscriptionPromise = wallet.onProofStateUpdates(
      swaps.flatMap((x) => x.proofsToSend),
      subscriptionCallback,
      (error) =>
        console.error('Proof state updates socket error', {
          cause: error,
        }),
    );

    this.subscriptions.set(mintUrl, {
      ids,
      subscriptionPromise,
      onSpent,
    });

    try {
      await subscriptionPromise;

      wallet.mint.webSocketConnection?.onClose((event) => {
        console.debug('Mint socket closed', { mintUrl, event });
        this.subscriptions.delete(mintUrl);
      });
    } catch (error) {
      this.subscriptions.delete(mintUrl);
      throw error;
    }
  }

  private async handleProofStateUpdate(
    proofUpdate: ProofState & { proof: Proof },
    swaps: PendingCashuSendSwap[],
    onSpent: (swap: CashuSendSwap) => void,
  ) {
    console.debug('proofUpdate', proofUpdate);
    const swap = swaps.find((swap) =>
      swap.proofsToSend.some((p) => p.C === proofUpdate.proof.C),
    );
    if (!swap) return;

    if (!this.proofUpdates[swap.id]) {
      this.proofUpdates[swap.id] = {};
    }

    this.proofUpdates[swap.id][proofUpdate.proof.C] = proofUpdate.state;

    const allProofsSpent = swap.proofsToSend.every(
      (proof) => this.proofUpdates[swap.id][proof.C] === 'SPENT',
    );

    console.debug('allProofsSpent', allProofsSpent, { swap });

    if (allProofsSpent) {
      delete this.proofUpdates[swap.id];
      onSpent(swap);
    }
  }
}
