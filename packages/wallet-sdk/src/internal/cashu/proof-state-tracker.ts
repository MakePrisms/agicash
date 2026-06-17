import type { CashuSendSwap, PendingCashuSendSwap } from '../../domains/cashu-send-swap';
import { ProofStateSubscriptionManager } from './proof-state-subscription-manager';

export type ProofStateTrackerDeps = {
  /** Resolve a swap's account to its mint URL (was getCashuAccount(accountId).mintUrl). */
  getMintUrl: (accountId: string) => string;
  /** Fired by the manager when ALL of a swap's proofs are observed SPENT. */
  onSpent: (swap: CashuSendSwap) => void;
};

/**
 * Framework-free port of `useOnProofStateChange`. Groups pending send-swaps by mint and
 * subscribes proof-state updates; the underlying `ProofStateSubscriptionManager` calls
 * `onSpent(swap)` once all of a swap's proofs are SPENT. Caller owns one instance and
 * calls `update()` whenever its pending-swap work set changes.
 */
export class ProofStateTracker {
  private readonly manager = new ProofStateSubscriptionManager();

  update(swaps: PendingCashuSendSwap[], deps: ProofStateTrackerDeps): void {
    if (swaps.length === 0) return;

    const swapsByMint = swaps.reduce<Record<string, PendingCashuSendSwap[]>>((acc, swap) => {
      (acc[deps.getMintUrl(swap.accountId)] ??= []).push(swap);
      return acc;
    }, {});

    for (const [mintUrl, mintSwaps] of Object.entries(swapsByMint)) {
      void this.manager
        .subscribe({ mintUrl, swaps: mintSwaps, onSpent: deps.onSpent })
        .catch((cause) =>
          console.error('Failed to subscribe to proof state updates', { mintUrl, cause }),
        );
    }
  }

  /**
   * No-op: the tracker holds no local timers, and WS teardown is owned by the cashu wallet
   * (matches the app, which never unsubscribed, and the melt/mint trackers). 4c decides any
   * explicit WS teardown on background.stop().
   */
  dispose(): void {}
}
