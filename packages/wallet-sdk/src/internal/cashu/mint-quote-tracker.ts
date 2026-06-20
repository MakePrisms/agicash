import {
  HttpResponseError,
  type MintQuoteBolt11Response,
  type WebSocketSupport,
} from '@cashu/cashu-ts';
import type { Currency } from '@agicash/money';
import { type LongTimeout, clearLongTimeout, setLongTimeout } from '../timeout';
import { withRetry } from '../with-retry';
import { MintQuoteSubscriptionManager } from './mint-quote-subscription-manager';
import type { ExtendedCashuWallet } from './wallet';

export type MintQuoteTrackerQuote = {
  quoteId: string;
  accountId: string;
  mintUrl: string;
  currency: Currency;
  state: string; // 'UNPAID' | 'PAID' | 'ISSUED' | 'EXPIRED'
  expiresAt: string;
};

export type MintQuoteTrackerDeps = {
  getWallet: (accountId: string) => ExtendedCashuWallet;
  /** Raw mint-quote delivery seam. Classification (→ onPaid/onIssued/onExpired) is the caller's job (4c). */
  onUpdate: (mintQuote: MintQuoteBolt11Response) => void;
};

/** NUT-17: does this mint support bolt11 mint-quote websocket updates? */
const mintSupportsWebSocketsForMintQuotes = (
  wallet: ExtendedCashuWallet,
): boolean => {
  const nut17Info = wallet.getMintInfo().isSupported(17);
  const params = nut17Info.params ?? [];
  return (
    nut17Info.supported &&
    params.some(
      (support: WebSocketSupport) =>
        support.method === 'bolt11' &&
        support.commands.includes('bolt11_mint_quote'),
    )
  );
};

/**
 * Framework-free port of the app's mint-quote tracking (useTrackMintQuotesWithWebSocket +
 * useTrackMintQuotesWithPolling + partition). Subscribes mints that support NUT-17 bolt11
 * mint-quote WS, polls the rest (10s; 60s after a 429), and schedules expiry rechecks for
 * UNPAID quotes on the WS path (sockets don't emit on expiry). Delivers raw mint quotes via
 * `onUpdate`. Caller owns one instance: `update()` on work-set change, `dispose()` on teardown.
 */
export class MintQuoteTracker {
  private readonly manager = new MintQuoteSubscriptionManager();
  private timeouts: LongTimeout[] = [];
  private pollTimers = new Set<ReturnType<typeof setTimeout>>();
  private generation = 0;

  update(quotes: MintQuoteTrackerQuote[], deps: MintQuoteTrackerDeps): void {
    const generation = ++this.generation;
    this.clearTimers();
    if (quotes.length === 0) return;

    const quotesToSubscribeTo: Record<string, MintQuoteTrackerQuote[]> = {};
    const quotesToPoll: MintQuoteTrackerQuote[] = [];
    for (const quote of quotes) {
      const wallet = deps.getWallet(quote.accountId);
      if (mintSupportsWebSocketsForMintQuotes(wallet)) {
        (quotesToSubscribeTo[quote.mintUrl] ??= []).push(quote);
      } else {
        quotesToPoll.push(quote);
      }
    }

    for (const [mintUrl, mintQuotes] of Object.entries(quotesToSubscribeTo)) {
      void this.manager
        .subscribe({
          mintUrl,
          quoteIds: mintQuotes.map((q) => q.quoteId),
          onUpdate: deps.onUpdate,
        })
        .catch((cause) =>
          console.error('Error subscribing to mint quote updates', {
            mintUrl,
            cause,
          }),
        );

      for (const quote of mintQuotes.filter((q) => q.state === 'UNPAID')) {
        const msUntilExpiration =
          new Date(quote.expiresAt).getTime() - Date.now();
        const t = setLongTimeout(async () => {
          try {
            const mintQuote = await withRetry({
              fn: () =>
                deps
                  .getWallet(quote.accountId)
                  .checkMintQuoteBolt11(quote.quoteId),
              retry: 5,
            });
            deps.onUpdate(mintQuote);
          } catch (cause) {
            console.error('Error checking mint quote upon expiration', {
              cause,
            });
          }
        }, msUntilExpiration);
        this.timeouts.push(t);
      }
    }

    for (const quote of quotesToPoll) {
      this.startPolling(quote, deps, generation);
    }
  }

  dispose(): void {
    ++this.generation;
    this.clearTimers();
    void this.manager
      .disposeAll()
      .catch((error) =>
        console.error('subscription teardown failed', { cause: error }),
      );
  }

  /** Self-scheduling poll loop: immediate fetch (matches useQuery mount), then every 10s (60s after a 429). */
  private startPolling(
    quote: MintQuoteTrackerQuote,
    deps: MintQuoteTrackerDeps,
    generation: number,
  ): void {
    const tick = async (): Promise<void> => {
      let nextDelay = 10 * 1000;
      try {
        const mintQuote = await deps
          .getWallet(quote.accountId)
          .checkMintQuoteBolt11(quote.quoteId);
        deps.onUpdate(mintQuote);
      } catch (error) {
        console.warn('Error checking mint quote', {
          cause: error,
          quoteId: quote.quoteId,
        });
        if (error instanceof HttpResponseError && error.status === 429) {
          nextDelay = 60 * 1000;
        }
      }
      if (generation !== this.generation) return;
      const id = setTimeout(() => {
        this.pollTimers.delete(id);
        void tick();
      }, nextDelay);
      this.pollTimers.add(id);
    };
    void tick();
  }

  private clearTimers(): void {
    for (const t of this.timeouts) clearLongTimeout(t);
    this.timeouts = [];
    for (const id of this.pollTimers) clearTimeout(id);
    this.pollTimers.clear();
  }
}
