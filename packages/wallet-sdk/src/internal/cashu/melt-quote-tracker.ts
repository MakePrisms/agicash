import type { Currency } from '@agicash/money';
import { type MeltQuoteBolt11Response, MeltQuoteState } from '@cashu/cashu-ts';
import { type LongTimeout, clearLongTimeout, setLongTimeout } from '../timeout';
import type { ExtendedCashuWallet } from './wallet';
import { MeltQuoteSubscriptionManager } from './melt-quote-subscription-manager';

export type MeltQuoteTrackerQuote = {
  id: string;
  mintUrl: string;
  currency: Currency;
  expiryInMs: number;
  inputAmount: number;
};

export type MeltQuoteTrackerDeps = {
  getWallet: (mintUrl: string, currency: Currency) => ExtendedCashuWallet;
  onUnpaid?: (meltQuote: MeltQuoteBolt11Response) => void;
  onPending?: (meltQuote: MeltQuoteBolt11Response) => void;
  onPaid?: (meltQuote: MeltQuoteBolt11Response) => void;
  onExpired?: (meltQuote: MeltQuoteBolt11Response) => void;
};

/**
 * Framework-free port of `useOnMeltQuoteStateChange`. Subscribes the given melt quotes
 * over NUT-17 (per mint), schedules expiry checks (sockets do not emit on expiry), and
 * classifies each update into onUnpaid/onPending/onPaid/onExpired. Reusable across
 * processors; the caller owns one instance, calls `update()` whenever its melt-quote
 * work set changes, and `dispose()` on teardown.
 */
export class MeltQuoteTracker {
  private readonly manager = new MeltQuoteSubscriptionManager();
  private timeouts: LongTimeout[] = [];
  private quotes: MeltQuoteTrackerQuote[] = [];
  private deps: MeltQuoteTrackerDeps | null = null;

  /** Forwarded so the cashu-send-quote processor can drop a quote's melt sub without unsubscribing the mint. */
  removeQuoteFromSubscription(args: {
    mintUrl: string;
    quoteId: string;
  }): void {
    this.manager.removeQuoteFromSubscription(args);
  }

  update(quotes: MeltQuoteTrackerQuote[], deps: MeltQuoteTrackerDeps): void {
    this.deps = deps;
    this.quotes = quotes;

    this.clearTimers();
    if (quotes.length === 0) return;

    const quotesByMint = quotes.reduce<Record<string, string[]>>((acc, q) => {
      (acc[q.mintUrl] ??= []).push(q.id);
      return acc;
    }, {});
    for (const [mintUrl, quoteIds] of Object.entries(quotesByMint)) {
      void this.manager
        .subscribe({ mintUrl, quoteIds, onUpdate: (mq) => this.handle(mq) })
        .catch((cause) =>
          console.error('Error subscribing to melt quote updates', {
            mintUrl,
            cause,
          }),
        );
    }

    for (const quote of quotes) {
      const msUntilExpiration = quote.expiryInMs - Date.now();
      const t = setLongTimeout(async () => {
        try {
          const wallet = this.deps?.getWallet(quote.mintUrl, quote.currency);
          if (!wallet) return;
          const meltQuote = await wallet.checkMeltQuoteBolt11(quote.id);
          await this.handle(meltQuote, true);
        } catch (cause) {
          console.error('Error checking melt quote upon expiration', { cause });
        }
      }, msUntilExpiration);
      this.timeouts.push(t);
    }
  }

  dispose(): void {
    this.clearTimers();
    this.deps = null;
    this.quotes = [];
    void this.manager
      .disposeAll()
      .catch((error) =>
        console.error('subscription teardown failed', { cause: error }),
      );
  }

  private clearTimers(): void {
    for (const t of this.timeouts) clearLongTimeout(t);
    this.timeouts = [];
  }

  private async handle(
    meltQuote: MeltQuoteBolt11Response,
    handleExpiry = false,
  ): Promise<void> {
    const cb = this.deps;
    if (!cb) return;
    const quoteData = this.quotes.find((q) => q.id === meltQuote.quote);
    if (!quoteData) return;

    if (meltQuote.state === MeltQuoteState.UNPAID) {
      if (new Date(quoteData.expiryInMs) > new Date()) {
        cb.onUnpaid?.(meltQuote);
      } else if (handleExpiry) {
        cb.onExpired?.(meltQuote);
      }
    } else if (meltQuote.state === MeltQuoteState.PENDING) {
      cb.onPending?.(meltQuote);
    } else if (meltQuote.state === MeltQuoteState.PAID) {
      // nutshell omits change on PAID updates — refetch to get change proofs.
      // https://github.com/cashubtc/nutshell/pull/788
      const expectChange = quoteData.inputAmount > meltQuote.amount;
      if (expectChange && !(meltQuote.change && meltQuote.change.length > 0)) {
        const wallet = cb.getWallet(quoteData.mintUrl, quoteData.currency);
        const meltQuoteWithChange = await wallet.checkMeltQuoteBolt11(
          quoteData.id,
        );
        cb.onPaid?.(meltQuoteWithChange);
      } else {
        cb.onPaid?.(meltQuote);
      }
    }
  }
}
