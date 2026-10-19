import { type ExtendedCashuWallet, getCashuWallet } from '@agicash/cashu';
import { isSubset } from '@agicash/utils';
import type { MintQuoteBolt11Response } from '@cashu/cashu-ts';
import type { Logger } from '../domain/sdk';

type SubscriptionData = {
  ids: Set<string>;
  subscriptionPromise: Promise<() => void>;
  onUpdate: (mintQuoteResponse: MintQuoteBolt11Response) => void;
};

export class MintQuoteSubscriptionManager {
  private subscriptions: Map<string, SubscriptionData> = new Map();
  private generation = 0;
  private readonly getWallet: (mintUrl: string) => ExtendedCashuWallet;

  constructor(
    private readonly logger: Logger,
    options: {
      /** Test seam; defaults to getCashuWallet */
      getWallet?: (mintUrl: string) => ExtendedCashuWallet;
    } = {},
  ) {
    this.getWallet = options.getWallet ?? getCashuWallet;
  }

  /**
   * Subscribes to mint quote updates for the given mint URL and quotes.
   * @param mintUrl - The mint URL to subscribe to.
   * @param quoteIds - The quote IDs to subscribe to.
   * @param onUpdate - The callback to call when a mint quote update is received.
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
    onUpdate: (mintQuoteResponse: MintQuoteBolt11Response) => void;
  }): Promise<() => void> {
    const generation = this.generation;
    const ids = new Set(quoteIds);
    const mintSubscription = this.subscriptions.get(mintUrl);

    if (mintSubscription) {
      const unsubscribe = await mintSubscription.subscriptionPromise;

      if (this.subscriptions.get(mintUrl) === mintSubscription) {
        if (isSubset(ids, mintSubscription.ids)) {
          this.subscriptions.set(mintUrl, {
            ...mintSubscription,
            onUpdate,
          });
          this.logger.debug(
            'Mint quote updates subscription already exists for mint. Updated callback.',
            { mintUrl, quoteCount: quoteIds.length },
          );
          return () => {
            unsubscribe();
            this.subscriptions.delete(mintUrl);
          };
        }

        this.logger.debug('Unsubscribing from mint quote updates for mint', {
          mintUrl,
        });
        unsubscribe();
      }
    }

    const wallet = this.getWallet(mintUrl);

    this.logger.debug('Subscribing to mint quote updates for mint', {
      mintUrl,
      quoteCount: quoteIds.length,
    });

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
        this.logger.error('Mint quote updates socket error', {
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

      if (generation !== this.generation) {
        this.deleteIfOwned(mintUrl, subscriptionPromise);
        unsubscribe();
        return () => undefined;
      }

      wallet.mint.webSocketConnection?.onClose((event) => {
        this.logger.debug('Mint socket closed', { mintUrl, event });
        this.deleteIfOwned(mintUrl, subscriptionPromise);
      });

      return () => {
        unsubscribe();
        this.subscriptions.delete(mintUrl);
      };
    } catch (error) {
      this.deleteIfOwned(mintUrl, subscriptionPromise);
      throw error;
    }
  }

  /** Calls every stored unsubscribe and forgets every subscription. */
  unsubscribeAll(): void {
    this.generation += 1;
    const subscriptions = [...this.subscriptions.values()];
    this.subscriptions.clear();
    for (const subscription of subscriptions) {
      subscription.subscriptionPromise.then(
        (unsubscribe) => unsubscribe(),
        () => undefined,
      );
    }
  }

  private deleteIfOwned(
    mintUrl: string,
    subscriptionPromise: Promise<() => void>,
  ): void {
    if (
      this.subscriptions.get(mintUrl)?.subscriptionPromise ===
      subscriptionPromise
    ) {
      this.subscriptions.delete(mintUrl);
    }
  }
}
