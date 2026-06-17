import type { Proof, ProofState } from '@cashu/cashu-ts';
import type { CashuSendSwap, PendingCashuSendSwap } from '../../../types/cashu';
import { isSubset } from '../sets';
import { toProof } from './proof';
import type { ExtendedCashuWallet } from './utils';

type Subscription = {
  ids: Set<string>;
  subscriptionPromise: Promise<() => void>;
  onSpent: (swap: CashuSendSwap) => void;
};

/** Subscribes to proof-state updates per mint; fires `onSpent` once a swap's proofs are all SPENT. */
export class ProofStateSubscriptionManager {
  private subscriptions = new Map<string, Subscription>();
  private proofUpdates: Record<string, Record<string, ProofState['state']>> = {};

  constructor(
    private readonly getWallet: (
      mintUrl: string,
    ) => Promise<ExtendedCashuWallet>,
  ) {}

  async subscribe({
    mintUrl,
    swaps,
    onSpent,
  }: {
    mintUrl: string;
    swaps: PendingCashuSendSwap[];
    onSpent: (swap: CashuSendSwap) => void;
  }): Promise<() => void> {
    const ids = swaps.map((x) => x.id);
    const idsSet = new Set(ids);
    const mintSubscription = this.subscriptions.get(mintUrl);

    if (mintSubscription) {
      const unsubscribe = await mintSubscription.subscriptionPromise;
      if (isSubset(idsSet, mintSubscription.ids)) {
        this.subscriptions.set(mintUrl, { ...mintSubscription, onSpent });
        return () => {
          unsubscribe();
          this.subscriptions.delete(mintUrl);
        };
      }
      unsubscribe();
    }

    const wallet = await this.getWallet(mintUrl);

    const subscriptionCallback = (proofUpdate: ProofState & { proof: Proof }) => {
      const current = this.subscriptions.get(mintUrl);
      if (current) {
        this.handleProofStateUpdate(proofUpdate, swaps, current.onSpent);
      }
    };

    const subscriptionPromise = wallet.on.proofStateUpdates(
      swaps.flatMap((x) => x.proofsToSend).map((p) => toProof(p)),
      subscriptionCallback,
      (error) =>
        console.error('Proof state updates socket error', { mintUrl, cause: error }),
    );

    this.subscriptions.set(mintUrl, { ids: idsSet, subscriptionPromise, onSpent });

    try {
      const unsubscribe = await subscriptionPromise;
      wallet.mint.webSocketConnection?.onClose(() => {
        this.subscriptions.delete(mintUrl);
      });
      return () => {
        unsubscribe();
        this.subscriptions.delete(mintUrl);
      };
    } catch (error) {
      this.subscriptions.delete(mintUrl);
      throw error;
    }
  }

  private handleProofStateUpdate(
    proofUpdate: ProofState & { proof: Proof },
    swaps: PendingCashuSendSwap[],
    onSpent: (swap: CashuSendSwap) => void,
  ): void {
    const swap = swaps.find((s) =>
      s.proofsToSend.some((p) => p.unblindedSignature === proofUpdate.proof.C),
    );
    if (!swap) return;

    this.proofUpdates[swap.id] ??= {};
    this.proofUpdates[swap.id][proofUpdate.proof.C] = proofUpdate.state;

    const allProofsSpent = swap.proofsToSend.every(
      (proof) => this.proofUpdates[swap.id][proof.unblindedSignature] === 'SPENT',
    );

    if (allProofsSpent) {
      delete this.proofUpdates[swap.id];
      onSpent(swap);
    }
  }
}
