import type { ExtendedCashuWallet } from '@agicash/cashu';
import type { Currency } from '@agicash/money';
import { withRetry as defaultWithRetry } from '@agicash/utils';
import {
  HttpResponseError,
  type MeltQuoteBolt11Response,
  MeltQuoteState,
  type MintQuoteBolt11Response,
  type WebSocketSupport,
} from '@cashu/cashu-ts';
import type { MeltQuoteSubscriptionManager } from '../../lib/melt-quote-subscription-manager';
import type { MintQuoteSubscriptionManager } from '../../lib/mint-quote-subscription-manager';
import type { CashuAccount } from '../accounts/account';
import type { CashuReceiveQuote } from '../receive/cashu-receive-quote';
import { type SagaStint, runWithRetry } from './task-saga';

const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const POLL_INTERVAL_MS = 10_000;
const RATE_LIMITED_POLL_INTERVAL_MS = 60_000;

/** Sleeps until `at` (ms since epoch) in chunks below setTimeout's cap; returns early when the scope dies. */
export async function delayUntil(stint: SagaStint, at: number): Promise<void> {
  while (stint.scope.alive) {
    const remaining = at - stint.now();
    if (remaining <= 0) {
      return;
    }
    await stint.scope.delay(Math.min(remaining, MAX_TIMEOUT_MS));
  }
}

export type MeltQuoteInput = {
  id: string;
  mintUrl: string;
  currency: Currency;
  expiryInMs: number;
  inputAmount: number;
};

export type MeltQuoteHandlers = {
  getWallet: (
    mintUrl: string,
    currency: Currency,
  ) => Promise<ExtendedCashuWallet>;
  onUnpaid?: (meltQuote: MeltQuoteBolt11Response) => void;
  onPending?: (meltQuote: MeltQuoteBolt11Response) => void;
  onPaid?: (meltQuote: MeltQuoteBolt11Response) => void;
  onExpired?: (meltQuote: MeltQuoteBolt11Response) => void;
  /** Called when an update or an expiry check fails; the saga re-arms the quote for the next reload. */
  onGiveUp?: () => void;
};

/** A stint-bound tracker. `reset` invalidates every armed expiry timer; the next `sync` re-arms them. */
export type QuoteTracker<T> = {
  sync(quotes: T[]): void;
  reset(): void;
};

/** Tracks melt quote state changes for one stint. Call `sync` after every working-set change. */
export function createMeltQuoteTracker(
  stint: SagaStint,
  manager: MeltQuoteSubscriptionManager,
  handlers: MeltQuoteHandlers,
): QuoteTracker<MeltQuoteInput> {
  let current = new Map<string, MeltQuoteInput>();
  const armed = new Map<string, symbol>();

  const handle = async (
    meltQuote: MeltQuoteBolt11Response,
    handleExpiry: boolean,
  ): Promise<void> => {
    if (!stint.scope.alive) {
      return;
    }
    stint.logger.debug(`Melt quote state changed: ${meltQuote.state}`);

    const quoteData = current.get(meltQuote.quote);
    if (!quoteData) {
      return;
    }

    if (meltQuote.state === MeltQuoteState.UNPAID) {
      if (quoteData.expiryInMs > stint.now()) {
        handlers.onUnpaid?.(meltQuote);
      } else if (handleExpiry) {
        handlers.onExpired?.(meltQuote);
      }
    } else if (meltQuote.state === MeltQuoteState.PENDING) {
      handlers.onPending?.(meltQuote);
    } else if (meltQuote.state === MeltQuoteState.PAID) {
      // Nutshell omits the change from melt quote state updates, so the quote
      // is re-checked to get the change: https://github.com/cashubtc/nutshell/pull/788
      const expectChange = quoteData.inputAmount > meltQuote.amount;
      if (expectChange && !(meltQuote.change && meltQuote.change.length > 0)) {
        const wallet = await handlers.getWallet(
          quoteData.mintUrl,
          quoteData.currency,
        );
        if (!stint.scope.alive) {
          return;
        }
        const meltQuoteWithChange = await wallet.checkMeltQuoteBolt11(
          quoteData.id,
        );
        if (!stint.scope.alive) {
          return;
        }
        handlers.onPaid?.(meltQuoteWithChange);
      } else {
        handlers.onPaid?.(meltQuote);
      }
    }
  };

  const onUpdate = (meltQuote: MeltQuoteBolt11Response): void => {
    stint.scope.track(
      handle(meltQuote, false).catch((error: unknown) => {
        if (!stint.scope.alive) {
          return;
        }
        stint.logger.error('Error handling melt quote update', {
          cause: error,
        });
        handlers.onGiveUp?.();
      }),
    );
  };

  const subscribe = (mintUrl: string, quoteIds: string[]): void => {
    stint.scope.track(
      (async () => {
        const outcome = await runWithRetry(
          stint,
          () => manager.subscribe({ mintUrl, quoteIds, onUpdate }),
          5,
        );
        if (!stint.scope.alive) {
          return;
        }
        if (outcome.status === 'failed') {
          stint.logger.error('Error subscribing to melt quote updates', {
            mintUrl,
            cause: outcome.error,
          });
        }
      })(),
    );
  };

  const arm = (quote: MeltQuoteInput): void => {
    const token = Symbol(quote.id);
    armed.set(quote.id, token);
    stint.scope.track(
      (async () => {
        await delayUntil(stint, quote.expiryInMs);
        if (!stint.scope.alive || armed.get(quote.id) !== token) {
          return;
        }
        const quoteData = current.get(quote.id);
        if (!quoteData) {
          return;
        }
        try {
          const wallet = await handlers.getWallet(
            quoteData.mintUrl,
            quoteData.currency,
          );
          if (!stint.scope.alive) {
            return;
          }
          const meltQuote = await wallet.checkMeltQuoteBolt11(quoteData.id);
          if (!stint.scope.alive) {
            return;
          }
          await handle(meltQuote, true);
        } catch (error) {
          if (!stint.scope.alive) {
            return;
          }
          if (armed.get(quote.id) === token) {
            armed.delete(quote.id);
          }
          stint.logger.error('Error checking melt quote upon expiration', {
            cause: error,
          });
          handlers.onGiveUp?.();
        }
      })(),
    );
  };

  return {
    sync(quotes) {
      if (!stint.scope.alive) {
        return;
      }
      current = new Map(quotes.map((quote) => [quote.id, quote]));
      for (const id of [...armed.keys()]) {
        if (!current.has(id)) {
          armed.delete(id);
        }
      }

      const quoteIdsByMint = new Map<string, string[]>();
      for (const quote of quotes) {
        const ids = quoteIdsByMint.get(quote.mintUrl) ?? [];
        quoteIdsByMint.set(quote.mintUrl, ids.concat(quote.id));
      }
      for (const [mintUrl, quoteIds] of quoteIdsByMint) {
        subscribe(mintUrl, quoteIds);
      }

      for (const quote of quotes) {
        if (!armed.has(quote.id)) {
          arm(quote);
        }
      }
    },
    reset() {
      armed.clear();
    },
  };
}

export type MintQuoteTarget = { quoteId: string; mintUrl: string };

export type MintQuoteTrackerOptions = {
  /** Test seam; defaults to `withRetry` from @agicash/utils. */
  withRetry?: typeof defaultWithRetry;
};

function supportsWebSocketsForMintQuotes(account: CashuAccount): boolean {
  const nut17Info = account.wallet.getMintInfo().isSupported(17);
  const params = nut17Info.params ?? [];
  return (
    nut17Info.supported &&
    params.some(
      (support: WebSocketSupport) =>
        support.method === 'bolt11' &&
        support.commands.includes('bolt11_mint_quote'),
    )
  );
}

/**
 * Tracks mint quotes over websockets, or by polling when the mint lacks
 * NUT-17 mint quote support. `sync`
 * resolves each quote's account first; the returned promise rejects when an
 * account read fails.
 */
export function createMintQuoteTracker(
  stint: SagaStint,
  manager: MintQuoteSubscriptionManager,
  handlers: {
    getAccount: (quoteId: string) => Promise<CashuAccount | undefined>;
    onUpdate: (mintQuote: MintQuoteBolt11Response) => void;
    /** Called when an expiry check fails; the saga re-arms the quote for the next reload. */
    onGiveUp?: () => void;
  },
  options?: MintQuoteTrackerOptions,
): {
  sync(quotes: CashuReceiveQuote[]): Promise<void>;
  reset(): void;
} {
  const withRetry = options?.withRetry ?? defaultWithRetry;
  let subscribed = new Map<string, CashuReceiveQuote>();
  const pollTargets = new Map<string, CashuReceiveQuote>();
  const polling = new Set<string>();
  const armed = new Map<string, symbol>();

  const onUpdate = (mintQuote: MintQuoteBolt11Response): void => {
    if (!stint.scope.alive) {
      return;
    }
    handlers.onUpdate(mintQuote);
  };

  const subscribe = (mintUrl: string, quoteIds: string[]): void => {
    stint.scope.track(
      (async () => {
        const outcome = await runWithRetry(
          stint,
          () => manager.subscribe({ mintUrl, quoteIds, onUpdate }),
          5,
        );
        if (!stint.scope.alive) {
          return;
        }
        if (outcome.status === 'failed') {
          stint.logger.error('Error subscribing to mint quote updates', {
            mintUrl,
            cause: outcome.error,
          });
        }
      })(),
    );
  };

  const checkMintQuote = async (
    quote: CashuReceiveQuote,
  ): Promise<MintQuoteBolt11Response> => {
    const account = await handlers.getAccount(quote.id);
    if (!stint.scope.alive) {
      throw new Error('Task stint ended');
    }
    if (!account) {
      throw new Error(`Account not found for id: ${quote.accountId}`);
    }
    return account.wallet.checkMintQuoteBolt11(quote.quoteId);
  };

  const arm = (quote: CashuReceiveQuote): void => {
    const token = Symbol(quote.id);
    armed.set(quote.id, token);
    stint.scope.track(
      (async () => {
        await delayUntil(stint, new Date(quote.expiresAt).getTime());
        if (!stint.scope.alive || armed.get(quote.id) !== token) {
          return;
        }
        const latest = subscribed.get(quote.id);
        if (!latest || latest.state !== 'UNPAID') {
          return;
        }
        try {
          const mintQuote = await withRetry({
            fn: () => checkMintQuote(latest),
            retry: 5,
            signal: stint.scope.signal,
          });
          if (!stint.scope.alive) {
            return;
          }
          handlers.onUpdate(mintQuote);
        } catch (error) {
          if (stint.scope.signal.aborted || !stint.scope.alive) {
            return;
          }
          if (armed.get(quote.id) === token) {
            armed.delete(quote.id);
          }
          stint.logger.error('Error checking mint quote upon expiration', {
            cause: error,
          });
          handlers.onGiveUp?.();
        }
      })(),
    );
  };

  const poll = (quoteId: string): void => {
    polling.add(quoteId);
    stint.scope.track(
      (async () => {
        while (stint.scope.alive) {
          const quote = pollTargets.get(quoteId);
          if (!quote) {
            break;
          }
          let rateLimited = false;
          try {
            const mintQuote = await checkMintQuote(quote);
            if (!stint.scope.alive) {
              return;
            }
            handlers.onUpdate(mintQuote);
          } catch (error) {
            if (!stint.scope.alive) {
              return;
            }
            rateLimited =
              error instanceof HttpResponseError && error.status === 429;
            stint.logger.warn('Error checking mint quote', {
              cause: error,
              quoteId: quote.quoteId,
            });
          }
          await stint.scope.delay(
            rateLimited ? RATE_LIMITED_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
          );
        }
        polling.delete(quoteId);
      })(),
    );
  };

  return {
    async sync(quotes) {
      if (!stint.scope.alive) {
        return;
      }
      const toSubscribe = new Map<string, CashuReceiveQuote[]>();
      const toPoll: CashuReceiveQuote[] = [];
      for (const quote of quotes) {
        const account = await handlers.getAccount(quote.id);
        if (!stint.scope.alive) {
          return;
        }
        if (!account) {
          continue;
        }
        if (supportsWebSocketsForMintQuotes(account)) {
          const forMint = toSubscribe.get(account.mintUrl) ?? [];
          toSubscribe.set(account.mintUrl, forMint.concat(quote));
        } else {
          toPoll.push(quote);
        }
      }

      subscribed = new Map(
        [...toSubscribe.values()].flat().map((quote) => [quote.id, quote]),
      );
      for (const id of [...armed.keys()]) {
        if (!subscribed.has(id)) {
          armed.delete(id);
        }
      }
      for (const [mintUrl, forMint] of toSubscribe) {
        subscribe(
          mintUrl,
          forMint.map((quote) => quote.quoteId),
        );
      }
      for (const quote of subscribed.values()) {
        if (quote.state === 'UNPAID' && !armed.has(quote.id)) {
          arm(quote);
        }
      }

      pollTargets.clear();
      for (const quote of toPoll) {
        pollTargets.set(quote.quoteId, quote);
      }
      for (const quoteId of pollTargets.keys()) {
        if (!polling.has(quoteId)) {
          poll(quoteId);
        }
      }
    },
    reset() {
      armed.clear();
    },
  };
}
