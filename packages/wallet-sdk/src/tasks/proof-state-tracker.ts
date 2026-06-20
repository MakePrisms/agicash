import { MutationObserver, type QueryClient } from '@tanstack/query-core';
import type { CashuAccount } from '../accounts/account';
import type {
  CashuSendSwap,
  PendingCashuSendSwap,
} from '../send/cashu-send-swap';
import { ProofStateSubscriptionManager } from '../send/proof-state-subscription-manager';

export type ProofStateTrackerOptions = {
  /** Drives the retrying subscribe mutation. */
  queryClient: QueryClient;
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

/**
 * Tracks the pending send swaps' proofs. It holds a single
 * {@link ProofStateSubscriptionManager}, groups the pending send swaps by their
 * account's mint url, and subscribes per mint; the manager handles one socket
 * per mint, the subset-dedup, and the multi-proof "all spent" aggregation that
 * fires {@link ProofStateTrackerOptions.onSpent}.
 *
 * The subscribe is dispatched through a `MutationObserver` with `retry: 5`.
 * `setSwaps` re-groups and re-subscribes for the new swap set; `stop` tears the
 * tracker down on deactivate.
 */
export class ProofStateTracker {
  private readonly getCashuAccount: (accountId: string) => CashuAccount;
  private readonly onSpent: ProofStateTrackerOptions['onSpent'];
  private stopped = false;
  private readonly subscriptionManager = new ProofStateSubscriptionManager();
  private readonly subscribeObserver: MutationObserver<
    () => void,
    Error,
    Parameters<ProofStateSubscriptionManager['subscribe']>[0]
  >;

  constructor(options: ProofStateTrackerOptions) {
    this.getCashuAccount = options.getCashuAccount;
    this.onSpent = options.onSpent;

    this.subscribeObserver = new MutationObserver(options.queryClient, {
      mutationFn: (props) => {
        // A retry that resolves after stop() must not re-open a socket.
        if (this.stopped) {
          return Promise.resolve<() => void>(() => undefined);
        }
        return this.subscriptionManager.subscribe(props);
      },
      retry: 5,
      onError: (error, variables) => {
        console.error('Failed to subscribe to proof state updates', {
          cause: error,
          mintUrl: variables.mintUrl,
        });
      },
    });
  }

  /**
   * Updates the work-set: groups the pending swaps by mint url and (re)subscribes
   * per mint.
   */
  setSwaps(swaps: PendingCashuSendSwap[]): void {
    this.stopped = false;
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
      this.subscribeObserver
        .mutate({
          mintUrl,
          swaps: mintSwaps,
          onSpent: (swap) => this.onSpent(swap),
        })
        .catch(() => undefined);
    }
  }

  /**
   * Tears the tracker down on deactivate: unsubscribes the per-mint proof-state
   * sockets and clears the accumulated proof state. Without this a deactivated
   * (non-leader) tab keeps its sockets open and can consume a swap's "all spent"
   * event — dropping the completion and orphaning the swap, because on
   * reactivation the manager would reuse the socket instead of re-subscribing
   * and the mint never re-delivers the now-spent state.
   */
  stop(): void {
    this.stopped = true;
    this.subscriptionManager.unsubscribeAll();
  }
}
