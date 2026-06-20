import type {
  ExtendedCashuWallet,
  MeltQuoteSubscriptionManager,
} from '@agicash/cashu';
import type { Currency } from '@agicash/utils/money';
import {
  type LongTimeout,
  clearLongTimeout,
  setLongTimeout,
} from '@agicash/utils/timeout';
import { type MeltQuoteBolt11Response, MeltQuoteState } from '@cashu/cashu-ts';
import { MutationObserver, type QueryClient } from '@tanstack/query-core';

/**
 * The work-set entry the tracker watches: one in-flight melt quote, its mint,
 * and the data needed to detect expiry and the NUT-08 change recovery.
 */
export type MeltQuoteWorkItem = {
  id: string;
  mintUrl: string;
  currency: Currency;
  expiryInMs: number;
  inputAmount: number;
};

export type MeltQuoteTrackerOptions = {
  /** The query-core client backing the retrying subscribe mutation. */
  queryClient: QueryClient;
  /**
   * The subscription manager the tracker drives. Injected by the family so the
   * family's transitions can call removeQuoteFromSubscription on the same
   * instance (re-subscribe correctness after a failed pay).
   */
  subscriptionManager: MeltQuoteSubscriptionManager;
  /**
   * Resolves the cashu wallet for a mint/currency. Used for the change-recovery
   * refetch and the expiry check.
   */
  getWallet: (mintUrl: string, currency: Currency) => ExtendedCashuWallet;
  onUnpaid?: (meltQuote: MeltQuoteBolt11Response) => void;
  onPending?: (meltQuote: MeltQuoteBolt11Response) => void;
  onPaid?: (meltQuote: MeltQuoteBolt11Response) => void;
  onExpired?: (meltQuote: MeltQuoteBolt11Response) => void;
};

/**
 * Tracks a work-set of in-flight melt quotes: subscribes one socket per mint
 * via the {@link MeltQuoteSubscriptionManager}, maps each `MeltQuoteState` to
 * the right callback, and arms a per-quote expiry timer (the mint sends no
 * state change on expiry). Includes the PAID-change-recovery workaround for
 * nutshell #788.
 *
 * `setQuotes` re-subscribes and re-arms the expiry timers for the new quote
 * set; `stop` clears the timers.
 */
export class MeltQuoteTracker {
  private readonly queryClient: QueryClient;
  private readonly subscriptionManager: MeltQuoteSubscriptionManager;
  private readonly getWallet: (
    mintUrl: string,
    currency: Currency,
  ) => ExtendedCashuWallet;
  private readonly onUnpaid?: (meltQuote: MeltQuoteBolt11Response) => void;
  private readonly onPending?: (meltQuote: MeltQuoteBolt11Response) => void;
  private readonly onPaid?: (meltQuote: MeltQuoteBolt11Response) => void;
  private readonly onExpired?: (meltQuote: MeltQuoteBolt11Response) => void;

  private quotes: MeltQuoteWorkItem[] = [];
  private stopped = false;
  private expiryTimers: LongTimeout[] = [];
  private subscribeObserver: MutationObserver<
    () => void,
    Error,
    Parameters<MeltQuoteSubscriptionManager['subscribe']>[0]
  >;

  constructor(options: MeltQuoteTrackerOptions) {
    this.queryClient = options.queryClient;
    this.subscriptionManager = options.subscriptionManager;
    this.getWallet = options.getWallet;
    this.onUnpaid = options.onUnpaid;
    this.onPending = options.onPending;
    this.onPaid = options.onPaid;
    this.onExpired = options.onExpired;

    // Retry/onError config for the subscribe, dispatched through a
    // MutationObserver.
    this.subscribeObserver = new MutationObserver(this.queryClient, {
      mutationFn: (
        props: Parameters<MeltQuoteSubscriptionManager['subscribe']>[0],
      ) => {
        // A retry that resolves after stop() must not re-open a socket.
        if (this.stopped) {
          return Promise.resolve<() => void>(() => undefined);
        }
        return this.subscriptionManager.subscribe(props);
      },
      retry: 5,
      onError: (error, variables) => {
        console.error('Error subscribing to melt quote updates', {
          mintUrl: variables.mintUrl,
          cause: error,
        });
      },
    });
  }

  /**
   * Updates the work-set and (re)subscribes per-mint + (re)arms the per-quote
   * expiry timers.
   */
  setQuotes(quotes: MeltQuoteWorkItem[]): void {
    this.stopped = false;
    this.quotes = quotes;
    this.resubscribe();
    this.rearmExpiryTimers();
  }

  /**
   * Tears the tracker down on deactivate: clears the expiry timers and
   * unsubscribes the per-mint sockets so a later reactivation re-subscribes
   * fresh. `stopped` blocks a subscribe retry that resolves after this from
   * re-opening a socket.
   */
  stop(): void {
    this.stopped = true;
    this.clearExpiryTimers();
    this.quotes = [];
    this.subscriptionManager.unsubscribeAll();
  }

  /**
   * Forwards to the injected subscription manager so the family can drop a
   * resolved quote from its mint subscription (re-subscribe correctness when
   * the same melt quote is reused for a new send after a failure).
   */
  removeQuoteFromSubscription(props: {
    mintUrl: string;
    quoteId: string;
  }): void {
    this.subscriptionManager.removeQuoteFromSubscription(props);
  }

  private resubscribe(): void {
    if (this.quotes.length === 0) {
      return;
    }

    const quotesByMint = this.quotes.reduce<Record<string, string[]>>(
      (acc, quote) => {
        const existingQuotesForMint = acc[quote.mintUrl] ?? [];
        acc[quote.mintUrl] = existingQuotesForMint.concat(quote.id);
        return acc;
      },
      {},
    );

    for (const [mintUrl, quoteIds] of Object.entries(quotesByMint)) {
      // Fire-and-forget; the retry/onError config handles failures.
      this.subscribeObserver
        .mutate({
          mintUrl,
          quoteIds,
          onUpdate: (meltQuote) => this.handleMeltQuoteUpdate(meltQuote),
        })
        .catch(() => undefined);
    }
  }

  private rearmExpiryTimers(): void {
    this.clearExpiryTimers();

    if (this.quotes.length === 0) {
      return;
    }

    for (const quote of this.quotes) {
      const msUntilExpiration = quote.expiryInMs - Date.now();
      const quoteTimeout = setLongTimeout(async () => {
        try {
          const wallet = this.getWallet(quote.mintUrl, quote.currency);
          const meltQuote = await wallet.checkMeltQuoteBolt11(quote.id);
          return this.handleMeltQuoteUpdate(meltQuote, true);
        } catch (error) {
          console.error('Error checking melt quote upon expiration', {
            cause: error,
          });
        }
      }, msUntilExpiration);
      this.expiryTimers.push(quoteTimeout);
    }
  }

  private clearExpiryTimers(): void {
    for (const timeout of this.expiryTimers) {
      clearLongTimeout(timeout);
    }
    this.expiryTimers = [];
  }

  private async handleMeltQuoteUpdate(
    meltQuote: MeltQuoteBolt11Response,
    handleExpiry = false,
  ): Promise<void> {
    console.debug(`Melt quote state changed: ${meltQuote.state}`);

    const quoteData = this.quotes.find((q) => q.id === meltQuote.quote);
    if (!quoteData) {
      return;
    }

    if (meltQuote.state === MeltQuoteState.UNPAID) {
      const expiresAt = new Date(quoteData.expiryInMs);
      const now = new Date();
      if (expiresAt > now) {
        this.onUnpaid?.(meltQuote);
      } else if (handleExpiry) {
        this.onExpired?.(meltQuote);
      }
    } else if (meltQuote.state === MeltQuoteState.PENDING) {
      this.onPending?.(meltQuote);
    } else if (meltQuote.state === MeltQuoteState.PAID) {
      // There is a bug in nutshell where the change is not included in the melt quote state updates, so we need to refetch the quote to get the change proofs.
      // see https://github.com/cashubtc/nutshell/pull/788
      const expectChange = quoteData.inputAmount > meltQuote.amount;
      if (expectChange && !(meltQuote.change && meltQuote.change.length > 0)) {
        const wallet = this.getWallet(quoteData.mintUrl, quoteData.currency);
        const meltQuoteWithChange = await wallet.checkMeltQuoteBolt11(
          quoteData.id,
        );
        this.onPaid?.(meltQuoteWithChange);
      } else {
        this.onPaid?.(meltQuote);
      }
    }
  }
}
