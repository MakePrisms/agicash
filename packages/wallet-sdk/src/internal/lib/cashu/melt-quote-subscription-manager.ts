import type { MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import { isSubset } from '../sets';
import type { ExtendedCashuWallet } from './utils';

type SubscriptionData = {
  ids: Set<string>;
  subscriptionPromise: Promise<() => void>;
  onUpdate: (meltQuoteResponse: MeltQuoteBolt11Response) => void;
};

/**
 * Tracks one cashu-ts melt-quote websocket per mint URL, covering all currently
 * subscribed quote ids for that mint. Reconnect/backoff is the caller's concern
 * (the manager only self-cleans on socket close / subscribe failure).
 */
export class MeltQuoteSubscriptionManager {
  private subscriptions = new Map<string, SubscriptionData>();

  constructor(
    private readonly getWallet: (
      mintUrl: string,
    ) => Promise<ExtendedCashuWallet>,
  ) {}

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
        this.subscriptions.set(mintUrl, { ...mintSubscription, onUpdate });
        return () => {
          unsubscribe();
          this.subscriptions.delete(mintUrl);
        };
      }
      unsubscribe();
    }

    const wallet = await this.getWallet(mintUrl);

    const subscriptionCallback = (meltQuote: MeltQuoteBolt11Response) => {
      this.subscriptions.get(mintUrl)?.onUpdate(meltQuote);
    };

    const subscriptionPromise = wallet.on.meltQuoteUpdates(
      Array.from(ids),
      subscriptionCallback,
      (error) =>
        console.error('Melt quote updates socket error', { mintUrl, cause: error }),
    );

    this.subscriptions.set(mintUrl, { ids, subscriptionPromise, onUpdate });

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

  /** Drop one quote id from a mint's tracked set without tearing down the socket. */
  removeQuoteFromSubscription({
    mintUrl,
    quoteId,
  }: {
    mintUrl: string;
    quoteId: string;
  }): void {
    const mintSubscription = this.subscriptions.get(mintUrl);
    if (!mintSubscription || !mintSubscription.ids.has(quoteId)) return;
    const ids = new Set(mintSubscription.ids);
    ids.delete(quoteId);
    this.subscriptions.set(mintUrl, { ...mintSubscription, ids });
  }
}
