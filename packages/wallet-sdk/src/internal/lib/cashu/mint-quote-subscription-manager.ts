import type { MintQuoteBolt11Response } from '@cashu/cashu-ts';
import { isSubset } from '../sets';
import type { ExtendedCashuWallet } from './utils';

type SubscriptionData = {
  ids: Set<string>;
  subscriptionPromise: Promise<() => void>;
  onUpdate: (mintQuoteResponse: MintQuoteBolt11Response) => void;
};

/** One cashu-ts mint-quote websocket per mint URL, covering all subscribed quote ids. */
export class MintQuoteSubscriptionManager {
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
    onUpdate: (mintQuoteResponse: MintQuoteBolt11Response) => void;
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

    const subscriptionCallback = (mintQuote: MintQuoteBolt11Response) => {
      this.subscriptions.get(mintUrl)?.onUpdate(mintQuote);
    };

    const subscriptionPromise = wallet.on.mintQuoteUpdates(
      Array.from(ids),
      subscriptionCallback,
      (error) =>
        console.error('Mint quote updates socket error', { mintUrl, cause: error }),
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
}
