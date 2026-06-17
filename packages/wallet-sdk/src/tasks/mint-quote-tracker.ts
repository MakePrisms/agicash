import { MintQuoteSubscriptionManager } from '@agicash/cashu';
import {
  type LongTimeout,
  clearLongTimeout,
  setLongTimeout,
} from '@agicash/utils/timeout';
import {
  HttpResponseError,
  type MintQuoteBolt11Response,
  type WebSocketSupport,
} from '@cashu/cashu-ts';
import {
  MutationObserver,
  type Query,
  type QueryClient,
  QueryObserver,
} from '@tanstack/query-core';
import type { CashuAccount } from '../accounts/account';

/**
 * The work-set entry the tracker watches: one pending receive quote, the mint
 * it was issued by, and the expiry needed to arm the no-socket-event expiry
 * timer.
 */
export type MintQuoteWorkItem = {
  /** The receive quote's mint-quote id (the id the mint subscribes/polls on). */
  quoteId: string;
  /** The receiving cashu account (resolves the wallet for WS/poll/expiry). */
  account: CashuAccount;
  /** The receive quote's current state (drives the unpaid-only expiry arming). */
  state: 'UNPAID' | 'PAID' | 'EXPIRED' | 'COMPLETED' | 'FAILED';
  /** Quote expiry as an absolute epoch-ms timestamp. */
  expiryInMs: number;
};

export type MintQuoteTrackerOptions = {
  /**
   * The query-core client backing the retrying subscribe mutation and the
   * per-quote polling observers.
   */
  queryClient: QueryClient;
  /**
   * Resolves the related pending receive quote for a mint-quote response. Used
   * to map a mint-quote state change onto the right receive-quote callback.
   */
  resolveQuote: (
    mintQuoteId: string,
  ) => { id: string; expiresAt: string } | undefined;
  onPaid?: (receiveQuoteId: string) => void;
  onIssued?: (receiveQuoteId: string) => void;
  onExpired?: (receiveQuoteId: string) => void;
};

const RETRY_LIMIT = 5;

/**
 * Returns whether the mint supports websockets for mint quotes: a pure
 * predicate over the mint's NUT-17 info deciding whether the mint can stream
 * `bolt11_mint_quote` updates over a socket (else the quote is polled).
 */
const mintSupportsWebSocketsForMintQuotes = (
  account: CashuAccount,
  currency: string,
): boolean => {
  const nut17Info = account.wallet.getMintInfo().isSupported(17);
  const params = nut17Info.params ?? [];
  return (
    nut17Info.supported &&
    params.some(
      (support: WebSocketSupport) =>
        support.method === 'bolt11' &&
        account.currency === currency &&
        support.commands.includes('bolt11_mint_quote'),
    )
  );
};

/**
 * Tracks a work-set of pending receive quotes and, per quote, either subscribes
 * a socket (NUT-17 mints) or polls (`10s`, `60s` after a 429) and arms a
 * per-unpaid-quote expiry timer (the mint emits no socket event on expiry).
 * `processMintQuote` maps a mint-quote response to the right receive-quote
 * callback.
 *
 * `setQuotes` re-partitions the quotes WS-vs-poll, re-subscribes, re-polls, and
 * re-arms the timers for the new quote set; `stop` tears the per-mint pollers
 * and timers down.
 */
export class MintQuoteTracker {
  private readonly queryClient: QueryClient;
  private readonly resolveQuote: MintQuoteTrackerOptions['resolveQuote'];
  private readonly onPaid?: (receiveQuoteId: string) => void;
  private readonly onIssued?: (receiveQuoteId: string) => void;
  private readonly onExpired?: (receiveQuoteId: string) => void;

  private quotes: MintQuoteWorkItem[] = [];
  private expiryTimers: LongTimeout[] = [];
  private pollObservers = new Map<string, QueryObserver<unknown>>();
  private pollUnsubscribes = new Map<string, () => void>();
  private readonly subscriptionManager = new MintQuoteSubscriptionManager();
  private readonly subscribeObserver: MutationObserver<
    () => void,
    Error,
    Parameters<MintQuoteSubscriptionManager['subscribe']>[0]
  >;

  constructor(options: MintQuoteTrackerOptions) {
    this.queryClient = options.queryClient;
    this.resolveQuote = options.resolveQuote;
    this.onPaid = options.onPaid;
    this.onIssued = options.onIssued;
    this.onExpired = options.onExpired;

    // Retry/onError config for the subscribe, dispatched through a
    // MutationObserver.
    this.subscribeObserver = new MutationObserver(this.queryClient, {
      mutationFn: (
        props: Parameters<MintQuoteSubscriptionManager['subscribe']>[0],
      ) => this.subscriptionManager.subscribe(props),
      retry: RETRY_LIMIT,
      onError: (error, variables) => {
        console.error('Error subscribing to mint quote updates', {
          mintUrl: variables.mintUrl,
          cause: error,
        });
      },
    });
  }

  /**
   * Updates the work-set: re-partitions the quotes WS-vs-poll, (re)subscribes
   * the socket mints, (re)starts the poll observers, and (re)arms the per-unpaid
   * expiry timers.
   */
  setQuotes(quotes: MintQuoteWorkItem[]): void {
    this.quotes = quotes;

    const quotesToSubscribeTo: Record<string, MintQuoteWorkItem[]> = {};
    const quotesToPoll: MintQuoteWorkItem[] = [];

    for (const quote of quotes) {
      const supportsWebSockets = mintSupportsWebSocketsForMintQuotes(
        quote.account,
        quote.account.currency,
      );
      if (supportsWebSockets) {
        const mintUrl = quote.account.mintUrl;
        const quotesForMint = quotesToSubscribeTo[mintUrl] ?? [];
        quotesToSubscribeTo[mintUrl] = quotesForMint.concat(quote);
      } else {
        quotesToPoll.push(quote);
      }
    }

    this.resubscribe(quotesToSubscribeTo);
    this.repoll(quotesToPoll);
    this.rearmExpiryTimers(quotesToSubscribeTo);
  }

  /** Tears down the poll observers and expiry timers. The socket subscriptions
   * are left to the mint's `onClose` / the next work-set reconcile (the
   * subscription manager has no caller-driven unsubscribe-all). */
  stop(): void {
    this.clearPollObservers();
    this.clearExpiryTimers();
    this.quotes = [];
  }

  private async processMintQuote(
    mintQuote: MintQuoteBolt11Response,
  ): Promise<void> {
    // Gate on the current work-set: a socket the manager left open (it has no
    // caller-driven unsubscribe-all) must not drive a transition once the quote
    // has left the work-set or the tracker has been stopped (leader handoff).
    const isTracked = this.quotes.some((q) => q.quoteId === mintQuote.quote);
    if (!isTracked) {
      return;
    }

    const relatedReceiveQuote = this.resolveQuote(mintQuote.quote);
    if (!relatedReceiveQuote) {
      console.warn('No related receive quote found for the mint quote');
      return;
    }

    console.debug(`Mint quote state changed: ${mintQuote.state}`, {
      receiveQuoteId: relatedReceiveQuote.id,
      unit: mintQuote.unit,
    });

    const expiresAt = new Date(relatedReceiveQuote.expiresAt);
    const now = new Date();

    if (mintQuote.state === 'UNPAID' && expiresAt < now) {
      this.onExpired?.(relatedReceiveQuote.id);
    } else if (mintQuote.state === 'PAID') {
      this.onPaid?.(relatedReceiveQuote.id);
    } else if (mintQuote.state === 'ISSUED') {
      this.onIssued?.(relatedReceiveQuote.id);
    }
  }

  private resubscribe(quotesByMint: Record<string, MintQuoteWorkItem[]>): void {
    for (const [mintUrl, quotes] of Object.entries(quotesByMint)) {
      // Fire-and-forget; the retry/onError config handles failures.
      this.subscribeObserver
        .mutate({
          mintUrl,
          quoteIds: quotes.map((q) => q.quoteId),
          onUpdate: (mintQuote) => this.processMintQuote(mintQuote),
        })
        .catch(() => undefined);
    }
  }

  private repoll(quotes: MintQuoteWorkItem[]): void {
    const wanted = new Set(quotes.map((q) => q.quoteId));

    for (const [quoteId, unsubscribe] of this.pollUnsubscribes) {
      if (!wanted.has(quoteId)) {
        unsubscribe();
        this.pollObservers.get(quoteId)?.destroy();
        this.pollUnsubscribes.delete(quoteId);
        this.pollObservers.delete(quoteId);
      }
    }

    for (const quote of quotes) {
      if (this.pollObservers.has(quote.quoteId)) {
        continue;
      }

      const observer = new QueryObserver<unknown>(this.queryClient, {
        queryKey: ['mint-quote', quote.quoteId],
        queryFn: async () => {
          try {
            const mintQuoteResponse =
              await quote.account.wallet.checkMintQuoteBolt11(quote.quoteId);
            await this.processMintQuote(mintQuoteResponse);
            return mintQuoteResponse;
          } catch (error) {
            console.warn('Error checking mint quote', {
              cause: error,
              quoteId: quote.quoteId,
            });
            return null;
          }
        },
        staleTime: 0,
        gcTime: 0,
        retry: false,
        refetchInterval: (query: Query) => {
          const error = query.state.error;
          const isRateLimitError =
            error instanceof HttpResponseError && error.status === 429;
          if (isRateLimitError) {
            return 60 * 1000;
          }
          return 10 * 1000;
        },
        refetchIntervalInBackground: true,
      });

      const unsubscribe = observer.subscribe(() => undefined);
      this.pollObservers.set(quote.quoteId, observer);
      this.pollUnsubscribes.set(quote.quoteId, unsubscribe);
    }
  }

  private rearmExpiryTimers(
    quotesByMint: Record<string, MintQuoteWorkItem[]>,
  ): void {
    this.clearExpiryTimers();

    // For unpaid receive quotes the mint sends no state change on expiry, so the
    // socket never notifies us; check the quote's state on the expiry deadline.
    // Polled quotes are covered by the poll loop, so only the WS quotes get a
    // timer.
    const unpaidQuotes = Object.values(quotesByMint)
      .flat()
      .filter((quote) => quote.state === 'UNPAID');

    if (unpaidQuotes.length === 0) {
      return;
    }

    for (const quote of unpaidQuotes) {
      const msUntilExpiration = quote.expiryInMs - Date.now();
      const quoteTimeout = setLongTimeout(async () => {
        try {
          const mintQuote = await this.getMintQuoteWithRetry(
            quote.account,
            quote.quoteId,
          );
          return this.processMintQuote(mintQuote);
        } catch (error) {
          console.error('Error checking mint quote upon expiration', {
            cause: error,
          });
        }
      }, msUntilExpiration);
      this.expiryTimers.push(quoteTimeout);
    }
  }

  // The expiry re-fetch retries up to 5 times with exponential backoff
  // (min(500 * 2^attempt, 30000)), then throws the last error.
  private async getMintQuoteWithRetry(
    account: CashuAccount,
    quoteId: string,
  ): Promise<MintQuoteBolt11Response> {
    let lastError: unknown;
    for (let attempt = 0; ; attempt++) {
      try {
        return await account.wallet.checkMintQuoteBolt11(quoteId);
      } catch (error) {
        lastError = error;
        if (attempt >= RETRY_LIMIT) {
          break;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(500 * 2 ** attempt, 30_000)),
        );
      }
    }
    throw lastError;
  }

  private clearPollObservers(): void {
    for (const unsubscribe of this.pollUnsubscribes.values()) {
      unsubscribe();
    }
    for (const observer of this.pollObservers.values()) {
      observer.destroy();
    }
    this.pollUnsubscribes.clear();
    this.pollObservers.clear();
  }

  private clearExpiryTimers(): void {
    for (const timeout of this.expiryTimers) {
      clearLongTimeout(timeout);
    }
    this.expiryTimers = [];
  }
}
