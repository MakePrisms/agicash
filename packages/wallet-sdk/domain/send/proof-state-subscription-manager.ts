import { getCashuWallet } from '@agicash/cashu';
import { isSubset } from '@agicash/utils';
import type { Proof, ProofState } from '@cashu/cashu-ts';
import { toProof } from '../accounts/cashu-account';
import type { Logger } from '../sdk';
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

  constructor(private readonly logger: Logger) {}

  /**
   * Subscribes to proof state updates for the given mint URL and swaps.
   * @param mintUrl - The mint URL to subscribe to.
   * @param swaps - The swaps to subscribe to.
   * @param onSpent - The callback to call when a proof is spent.
   * @returns A function to unsubscribe from the subscription.
   * @throws An error if the subscription fails.
   */
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
        this.subscriptions.set(mintUrl, {
          ...mintSubscription,
          onSpent,
        });
        this.logger.debug(
          'Proof state updates subscription already exists for mint. Updated callback.',
          {
            mintUrl,
            swapIds: ids,
          },
        );
        return () => {
          unsubscribe();
          this.subscriptions.delete(mintUrl);
        };
      }

      this.logger.debug(
        'Unsubscribing from proof state updates for mint',
        mintUrl,
      );
      unsubscribe();
    }

    const wallet = getCashuWallet(mintUrl);

    this.logger.debug('Subscribing to proof state updates for mint', {
      mintUrl,
      swapIds: ids,
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

    const subscriptionPromise = wallet.on.proofStateUpdates(
      swaps.flatMap((x) => x.proofsToSend).map((p) => toProof(p)),
      subscriptionCallback,
      (error) =>
        this.logger.error('Proof state updates socket error', {
          cause: error,
        }),
    );

    this.subscriptions.set(mintUrl, {
      ids: idsSet,
      subscriptionPromise,
      onSpent,
    });

    try {
      const unsubscribe = await subscriptionPromise;

      wallet.mint.webSocketConnection?.onClose((event) => {
        this.logger.debug('Mint socket closed', { mintUrl, event });
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

  /** Drops every mint subscription without waiting for the sockets to close. */
  unsubscribeAll(): void {
    for (const entry of this.subscriptions.values()) {
      void entry.subscriptionPromise.then(
        (unsubscribe) => unsubscribe(),
        () => undefined,
      );
    }
    this.subscriptions.clear();
  }

  private async handleProofStateUpdate(
    proofUpdate: ProofState & { proof: Proof },
    swaps: PendingCashuSendSwap[],
    onSpent: (swap: CashuSendSwap) => void,
  ) {
    const swap = swaps.find((swap) =>
      swap.proofsToSend.some(
        (p) => p.unblindedSignature === proofUpdate.proof.C,
      ),
    );
    if (!swap) return;

    if (!this.proofUpdates[swap.id]) {
      this.proofUpdates[swap.id] = {};
    }

    this.proofUpdates[swap.id][proofUpdate.proof.C] = proofUpdate.state;

    const allProofsSpent = swap.proofsToSend.every(
      (proof) =>
        this.proofUpdates[swap.id][proof.unblindedSignature] === 'SPENT',
    );

    this.logger.debug('allProofsSpent', { allProofsSpent, swapId: swap.id });

    if (allProofsSpent) {
      delete this.proofUpdates[swap.id];
      onSpent(swap);
    }
  }
}
