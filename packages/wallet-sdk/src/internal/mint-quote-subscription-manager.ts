/**
 * Mint mint-quote WebSocket subscription manager — Slice 3 / PR5d.
 *
 * LIFTED near-verbatim (framework-free already) from
 * `apps/web-wallet/app/lib/cashu/mint-quote-subscription-manager.ts`. The SDK's "live protocol
 * connection" for cashu lightning RECEIVE quotes (§0 state kind 3): a per-mint-URL map of NUT-17
 * `bolt11_mint_quote` subscriptions over each mint's WebSocket. The orchestrator's cashu
 * receive-quote state machine drives UNPAID → PAID → COMPLETED off these updates (for mints that
 * advertise WebSocket support; the orchestrator polls the rest).
 *
 * Re-housing vs master: identical to {@link MeltQuoteSubscriptionManager} — the `getCashuWallet`
 * factory is INJECTED rather than imported, and `isSubset` comes from the `./lib-timeout` seam.
 *
 * @module
 */
import type { MintQuoteBolt11Response } from '@cashu/cashu-ts';
import type { ExtendedCashuWallet } from './lib-cashu-wallet';
import { isSubset } from './lib-timeout';

/** Per-mint subscription bookkeeping (master verbatim). */
type SubscriptionData = {
  ids: Set<string>;
  subscriptionPromise: Promise<() => void>;
  onUpdate: (mintQuoteResponse: MintQuoteBolt11Response) => void;
};

/** A factory that returns a (cashu-ts) wallet for a mint URL — injected so the orchestrator can supply an account's live, keyset-loaded handle. */
export type GetMintSubscriptionWallet = (
  mintUrl: string,
) => ExtendedCashuWallet;

/**
 * Manages NUT-17 mint-quote WebSocket subscriptions, one per mint URL. Lifted from master's
 * `MintQuoteSubscriptionManager`; framework-free.
 */
export class MintQuoteSubscriptionManager {
  private subscriptions: Map<string, SubscriptionData> = new Map();

  /**
   * @param getWallet - the wallet factory (the orchestrator always injects one).
   */
  constructor(private readonly getWallet: GetMintSubscriptionWallet) {}

  /**
   * Subscribe to mint-quote updates for the given mint URL and quotes. Master verbatim (wallet
   * factory injected).
   *
   * @param params.mintUrl - the mint URL to subscribe to.
   * @param params.quoteIds - the mint-quote ids to subscribe to.
   * @param params.onUpdate - callback invoked on each mint-quote update.
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
    onUpdate: (mintQuoteResponse: MintQuoteBolt11Response) => void;
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

    const subscriptionCallback = (mintQuote: MintQuoteBolt11Response) => {
      const currentSubscription = this.subscriptions.get(mintUrl);
      if (currentSubscription) {
        currentSubscription.onUpdate(mintQuote);
      }
    };

    const subscriptionPromise = wallet.on.mintQuoteUpdates(
      Array.from(ids),
      subscriptionCallback,
      (error) =>
        console.error('Mint quote updates socket error', {
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
