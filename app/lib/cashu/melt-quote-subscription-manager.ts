import type { MeltQuoteResponse } from '@cashu/cashu-ts';
import { getCashuWallet } from '~/lib/cashu';
import { isSubset } from '~/lib/utils';

type SubscriptionData = {
  ids: Set<string>;
  subscriptionPromise: Promise<() => void>;
  onUpdate: (meltQuoteResponse: MeltQuoteResponse) => void;
};

export class MeltQuoteSubscriptionManager {
  private subscriptions: Map<string, SubscriptionData> = new Map();

  /**
   * Subscribes to melt quote updates for the given mint URL and quotes.
   * @param mintUrl - The mint URL to subscribe to.
   * @param quoteIds - The quote IDs to subscribe to.
   * @param onUpdate - The callback to call when a melt quote update is received.
   * @returns A function to unsubscribe from the subscription.
   * @throws An error if the subscription fails.
   */
  async subscribe({
    mintUrl,
    quoteIds,
    onUpdate,
  }: {
    mintUrl: string;
    quoteIds: string[];
    onUpdate: (meltQuoteResponse: MeltQuoteResponse) => void;
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
        console.debug(
          'Melt quote updates subscription already exists for mint. Updated callback.',
          { mintUrl, quoteCount: quoteIds.length },
        );
        return () => {
          unsubscribe();
          this.subscriptions.delete(mintUrl);
        };
      }

      console.debug('Unsubscribing from melt quote updates for mint', mintUrl);
      unsubscribe();
    }

    const wallet = getCashuWallet(mintUrl);

    console.debug('Subscribing to melt quote updates for mint', {
      mintUrl,
      quoteCount: quoteIds.length,
    });

    const subscriptionCallback = (meltQuote: MeltQuoteResponse) => {
      const currentSubscription = this.subscriptions.get(mintUrl);
      if (currentSubscription) {
        currentSubscription.onUpdate(meltQuote);
      }
    };

    const subscriptionPromise = wallet.onMeltQuoteUpdates(
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

      wallet.mint.webSocketConnection?.onClose((event) => {
        console.debug('Mint socket closed', { mintUrl, event });
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
   * Removes a quote from the subscription data.
   * Note that this doesn't unsubscribe from the mint quote updates.
   * Noop if the manager is not subscribed for the provided mint URL or the quote.
   * @param mintUrl - The mint URL to remove the quote from.
   * @param quoteId - The quote ID to remove.
   */
  removeQuoteFromSubscription({
    mintUrl,
    quoteId,
  }: {
    mintUrl: string;
    quoteId: string;
  }) {
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
}
