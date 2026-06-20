import { retryWithBackoff } from '@agicash/utils/retry';
import type { CashuAccount } from '../accounts/account';
import type {
  CashuSendSwap,
  PendingCashuSendSwap,
} from '../send/cashu-send-swap';
import { ProofStateSubscriptionManager } from '../send/proof-state-subscription-manager';

export type ProofStateTrackerOptions = {
  /**
   * Resolves the cashu account (and thus its mint url) for a swap's accountId.
   * @throws if the account is not a known cashu account.
   */
  getCashuAccount: (accountId: string) => CashuAccount;
  /**
   * Called when all of a pending swap's proofs are detected as SPENT (the
   * manager aggregates the multi-proof "all spent" condition).
   */
  onSpent: (swap: CashuSendSwap) => void;
};

const SUBSCRIBE_RETRIES = 5;

/**
 * Tracks the pending send swaps' proofs. It holds a single
 * {@link ProofStateSubscriptionManager}, groups the pending send swaps by their
 * account's mint url, and subscribes per mint; the manager handles one socket
 * per mint, the subset-dedup, and the multi-proof "all spent" aggregation that
 * fires {@link ProofStateTrackerOptions.onSpent}.
 *
 * The subscribe is retried with backoff and bound to an abort signal. `setSwaps`
 * re-groups and re-subscribes for the new swap set; `stop` aborts the in-flight
 * subscribe retries and unsubscribes the sockets on deactivate.
 */
export class ProofStateTracker {
  private readonly getCashuAccount: (accountId: string) => CashuAccount;
  private readonly onSpent: ProofStateTrackerOptions['onSpent'];
  private abortController = new AbortController();
  private readonly subscriptionManager = new ProofStateSubscriptionManager();

  constructor(options: ProofStateTrackerOptions) {
    this.getCashuAccount = options.getCashuAccount;
    this.onSpent = options.onSpent;
  }

  /**
   * Updates the work-set: groups the pending swaps by mint url and (re)subscribes
   * per mint.
   */
  setSwaps(swaps: PendingCashuSendSwap[]): void {
    if (this.abortController.signal.aborted) {
      this.abortController = new AbortController();
    }

    const swapsByMint = swaps.reduce<Record<string, PendingCashuSendSwap[]>>(
      (acc, swap) => {
        const account = this.getCashuAccount(swap.accountId);
        const existing = acc[account.mintUrl] ?? [];
        acc[account.mintUrl] = existing.concat(swap);
        return acc;
      },
      {},
    );

    for (const [mintUrl, mintSwaps] of Object.entries(swapsByMint)) {
      retryWithBackoff(
        () =>
          this.subscriptionManager.subscribe({
            mintUrl,
            swaps: mintSwaps,
            onSpent: (swap) => this.onSpent(swap),
          }),
        {
          retries: SUBSCRIBE_RETRIES,
          signal: this.abortController.signal,
          onError: (error) =>
            console.error('Failed to subscribe to proof state updates', {
              cause: error,
              mintUrl,
            }),
        },
      ).catch(() => undefined);
    }
  }

  /**
   * Tears the tracker down on deactivate: aborts the in-flight subscribe retries,
   * unsubscribes the per-mint proof-state sockets, and clears the accumulated
   * proof state. Without this a deactivated (non-leader) tab keeps its sockets
   * open and can consume a swap's "all spent" event — dropping the completion and
   * orphaning the swap, because on reactivation the manager would reuse the
   * socket instead of re-subscribing and the mint never re-delivers the now-spent
   * state.
   */
  stop(): void {
    this.abortController.abort();
    this.subscriptionManager.unsubscribeAll();
  }
}
