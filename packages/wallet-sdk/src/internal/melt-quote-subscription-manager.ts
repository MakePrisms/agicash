/**
 * Mint melt-quote WebSocket subscription manager — Slice 3 / PR5d.
 *
 * LIFTED near-verbatim (framework-free already) from
 * `apps/web-wallet/app/lib/cashu/melt-quote-subscription-manager.ts`. This is the SDK's "live
 * protocol connection" for cashu SEND quotes (§0 state kind 3): a per-mint-URL map of NUT-17
 * `bolt11_melt_quote` subscriptions over each mint's WebSocket. The orchestrator's cashu
 * send-quote + cross-account token-receive state machines drive their UNPAID → PENDING → PAID
 * transitions off these updates.
 *
 * Re-housing vs master:
 *  - master imported `getCashuWallet` from `~/lib/cashu` directly; here the wallet factory is
 *    INJECTED (`getWallet(mintUrl)`) so the orchestrator can pass an account's live
 *    `ExtendedCashuWallet` (already keyset-loaded) and fall back to a bare `getCashuWallet` for a
 *    source mint the user has no account for (the cross-account token path). The injected factory
 *    is the same `getCashuWallet` re-exported by `./lib-cashu-wallet`;
 *  - `isSubset` comes from `./lib-timeout` (the single-source seam);
 *  - no other change — the Map/subscription/onClose lifecycle is identical.
 *
 * @module
 */
import type { MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import type { ExtendedCashuWallet } from './lib-cashu-wallet';
import { isSubset } from './lib-timeout';

/** Per-mint subscription bookkeeping (master verbatim). */
type SubscriptionData = {
  ids: Set<string>;
  subscriptionPromise: Promise<() => void>;
  onUpdate: (meltQuoteResponse: MeltQuoteBolt11Response) => void;
};

/** A factory that returns a (cashu-ts) wallet for a mint URL — injected so the orchestrator can supply an account's live, keyset-loaded handle. */
export type GetMeltSubscriptionWallet = (
  mintUrl: string,
) => ExtendedCashuWallet;

/**
 * Manages NUT-17 melt-quote WebSocket subscriptions, one per mint URL. Lifted from master's
 * `MeltQuoteSubscriptionManager` (the in-flight working-set's live connection); framework-free.
 */
export class MeltQuoteSubscriptionManager {
  private subscriptions: Map<string, SubscriptionData> = new Map();

  /**
   * @param getWallet - the wallet factory (defaults to none — the orchestrator always injects one).
   */
  constructor(private readonly getWallet: GetMeltSubscriptionWallet) {}

  /**
   * Subscribe to melt-quote updates for the given mint URL and quotes. If a subscription for the
   * mint already covers these ids, the callback is swapped in place; otherwise the old one is
   * torn down and a fresh subscription opened. Master verbatim (wallet factory injected).
   *
   * @param params.mintUrl - the mint URL to subscribe to.
   * @param params.quoteIds - the melt-quote ids to subscribe to.
   * @param params.onUpdate - callback invoked on each melt-quote update.
   * @returns an unsubscribe function.
   * @throws Error if the subscription fails.
   */
  async subscribe({
    mintUrl,
    quoteIds,
    onUpdate,
  }: {
    mintUrl: string;
    quoteIds: string[];
    onUpdate: (meltQuoteResponse: MeltQuoteBolt11Response) => void;
  }): Promise<() => void> {
    const ids = new Set(quoteIds);
    const mintSubscription = this.subscriptions.get(mintUrl);

    if (mintSubscription) {
      const unsubscribe = await mintSubscription.subscriptionPromise;

      if (isSubset(ids, mintSubscription.ids)) {
        this.subscriptions.set(mintUrl, {
          ...mintSubscription,
          onUpdate,
        });
        return () => {
          unsubscribe();
          this.subscriptions.delete(mintUrl);
        };
      }

      unsubscribe();
    }

    const wallet = this.getWallet(mintUrl);

    const subscriptionCallback = (meltQuote: MeltQuoteBolt11Response) => {
      const currentSubscription = this.subscriptions.get(mintUrl);
      if (currentSubscription) {
        currentSubscription.onUpdate(meltQuote);
      }
    };

    const subscriptionPromise = wallet.on.meltQuoteUpdates(
      Array.from(ids),
      subscriptionCallback,
      (error) =>
        console.error('Melt quote updates socket error', {
          cause: error,
        }),
    );

    this.subscriptions.set(mintUrl, {
      ids,
      subscriptionPromise,
      onUpdate,
    });

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

  /**
   * Remove a quote from a mint's subscription bookkeeping (does NOT unsubscribe the socket).
   * No-op if the manager is not subscribed for that mint or quote. Master verbatim. Used after a
   * send is failed-then-recreated with the same melt quote, so the new send re-triggers.
   *
   * @param params.mintUrl - the mint URL to remove the quote from.
   * @param params.quoteId - the melt-quote id to remove.
   */
  removeQuoteFromSubscription({
    mintUrl,
    quoteId,
  }: {
    mintUrl: string;
    quoteId: string;
  }): void {
    const mintSubscription = this.subscriptions.get(mintUrl);
    if (!mintSubscription || !mintSubscription.ids.has(quoteId)) {
      return;
    }

    const ids = new Set(mintSubscription.ids);
    ids.delete(quoteId);
    this.subscriptions.set(mintUrl, {
      ...mintSubscription,
      ids,
    });
  }

  /** Tear down every open subscription (called when the orchestrator / SDK is destroyed). */
  async closeAll(): Promise<void> {
    const subscriptions = Array.from(this.subscriptions.values());
    this.subscriptions.clear();
    await Promise.all(
      subscriptions.map(async (s) => {
        try {
          const unsubscribe = await s.subscriptionPromise;
          unsubscribe();
        } catch {
          // The subscription never opened — nothing to tear down.
        }
      }),
    );
  }
}
