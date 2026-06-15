import {
  MutationObserver,
  type MutationScope,
  type QueryClient,
  QueryObserver,
} from '@tanstack/query-core';
import type { SparkAccount } from '../accounts/account';
import type { AccountsCache } from '../accounts/accounts-cache';
import { DomainError } from '../error';
import type { SparkSendQuote } from '../send/spark-send-quote';
import type { UnresolvedSparkSendQuotesCache } from '../send/spark-send-quote-cache';
import type { SparkSendQuoteService } from '../send/spark-send-quote-service';
import { sparkDebugLog } from '../spark-config';
import type { SagaProcessor } from './processor';
import { SparkSendTracker } from './spark-send-tracker';

export type SparkSendQuoteProcessorDeps = {
  queryClient: QueryClient;
  /** The spark-send-quote saga service the transitions call. */
  sparkSendQuoteService: SparkSendQuoteService;
  /** The unresolved-send-quotes state the mutationFns re-read the live entity from. */
  unresolvedSparkSendQuotesCache: UnresolvedSparkSendQuotesCache;
  /** Accounts state: resolves the send account + the online-account work-set filter. */
  accountsCache: AccountsCache;
  /** The query config for the current user's unresolved spark send quotes. */
  unresolvedSparkQuotesOptions: () => {
    queryKey: string[];
    queryFn: () => Promise<SparkSendQuote[]>;
    staleTime: number;
  };
};

/**
 * The headless spark-send-quote saga processor — a behavior-preserving lift of
 * the web's `useProcessSparkSendQuoteTasks`. While active (leader) it:
 *  - watches the current user's unresolved spark send quotes that belong to an
 *    online account (the same `select` the web's
 *    `useSelectItemsWithOnlineAccount` applied);
 *  - drives a {@link SparkSendTracker} (one Breez listener per spark account +
 *    the initial getPayment check; fires UNPAID immediately, COMPLETED/FAILED
 *    on payment events) to detect each state change;
 *  - on each detected change dispatches the matching transition through a
 *    query-core `MutationObserver` with the SAME scope ids, retry policy, and
 *    onSuccess cache-write discipline the web mutations used.
 *
 * Every transition re-reads the live entity from the unresolved cache and
 * early-returns if it is gone ("updated in the meantime"), exactly as the web
 * mutationFns did. The web's `isPending`-style callback guards are subsumed by
 * the per-scope MutationObserver serialization plus the cache re-read guard;
 * the tracker's `lastTriggeredState` dedup (which serialization does not cover)
 * is preserved in {@link SparkSendTracker}.
 *
 * The Breez listener this attaches is the LEADER-ONLY saga listener and is
 * distinct from the always-on balance listener `accounts.trackSparkBalances`
 * attaches to the same shared `BreezSdk`; balance tracking is untouched.
 */
export function createSparkSendQuoteProcessor(
  deps: SparkSendQuoteProcessorDeps,
): SagaProcessor {
  const {
    queryClient,
    sparkSendQuoteService,
    unresolvedSparkSendQuotesCache,
    accountsCache,
    unresolvedSparkQuotesOptions,
  } = deps;

  const getSparkAccount = (id: string): SparkAccount => {
    const account = accountsCache.get(id);
    if (!account) {
      throw new Error(`Account not found for id: ${id}`);
    }
    if (account.type !== 'spark') {
      throw new Error(`Account with id: ${id} is not of type: spark`);
    }
    return account;
  };

  // Fire-and-forget dispatch matching react-query's `useMutation().mutate`,
  // which is `observer.mutate(vars, opts).catch(noop)` — the rejection is
  // swallowed (onError/throwOnError still run); the per-call scope rides in opts.
  function dispatch<TData, TVariables>(
    observer: MutationObserver<TData, Error, TVariables>,
    variables: TVariables,
    options?: { scope?: MutationScope },
  ): void {
    observer.mutate(variables, options).catch(() => undefined);
  }

  const failSendQuoteObserver = new MutationObserver<
    SparkSendQuote | undefined,
    Error,
    { quoteId: string; reason: string }
  >(queryClient, {
    mutationFn: async ({ quoteId, reason }) => {
      const quote = unresolvedSparkSendQuotesCache.get(quoteId);
      if (!quote) {
        // Quote is not pending anymore so it was removed from the cache.
        // This can happen if the quote was completed, failed or expired in the meantime.
        return;
      }

      return await sparkSendQuoteService.fail(quote, reason);
    },
    retry: 3,
    throwOnError: true,
    onSuccess: (updatedQuote) => {
      if (updatedQuote) {
        unresolvedSparkSendQuotesCache.remove(updatedQuote);
      }
    },
    onError: (error, variables) => {
      console.error('Failed to mark spark send quote as failed', {
        cause: error,
        sendQuoteId: variables.quoteId,
      });
    },
  });

  const initiateSendObserver = new MutationObserver<
    SparkSendQuote | undefined,
    Error,
    SparkSendQuote
  >(queryClient, {
    mutationFn: async (quote) => {
      const cachedQuote = unresolvedSparkSendQuotesCache.get(quote.id);
      if (cachedQuote?.state !== 'UNPAID') {
        // Quote was updated in the meantime, skip initiation.
        return undefined;
      }

      const account = getSparkAccount(quote.accountId);
      return sparkSendQuoteService
        .initiateSend({
          account,
          sendQuote: quote,
        })
        .catch((error): SparkSendQuote | undefined => {
          if (error instanceof DomainError) {
            dispatch(
              failSendQuoteObserver,
              {
                quoteId: quote.id,
                reason: error.message,
              },
              { scope: { id: `spark-send-quote-${quote.id}` } },
            );
            return undefined;
          }
          throw error;
        });
    },
    retry: 3,
    throwOnError: true,
    onSuccess: (updatedQuote) => {
      if (updatedQuote) {
        unresolvedSparkSendQuotesCache.update(updatedQuote);
      }
    },
    onError: (error, quote) => {
      console.error('Initiate spark send quote error', {
        cause: error,
        sendQuoteId: quote.id,
      });
    },
  });

  const completeSendQuoteObserver = new MutationObserver<
    SparkSendQuote | undefined,
    Error,
    { quote: SparkSendQuote; paymentPreimage: string }
  >(queryClient, {
    mutationFn: async ({ quote, paymentPreimage }) => {
      const cachedQuote = unresolvedSparkSendQuotesCache.get(quote.id);
      if (!cachedQuote) {
        // Quote was updated in the meantime so it's not unresolved anymore.
        return;
      }
      return sparkSendQuoteService.complete(quote, paymentPreimage);
    },
    retry: 3,
    throwOnError: true,
    onSuccess: (updatedQuote) => {
      if (updatedQuote) {
        sparkDebugLog('Send quote completed', {
          quoteId: updatedQuote.id,
          accountId: updatedQuote.accountId,
        });
        unresolvedSparkSendQuotesCache.remove(updatedQuote);
      }
    },
    onError: (error, { quote }) => {
      console.error('Complete spark send quote error', {
        cause: error,
        sendQuoteId: quote.id,
      });
    },
  });

  const tracker = new SparkSendTracker({
    getSparkAccount,
    onUnpaid: (quote) => {
      dispatch(initiateSendObserver, quote, {
        scope: { id: `spark-send-quote-${quote.id}` },
      });
    },
    onCompleted: (quote, paymentData) => {
      dispatch(
        completeSendQuoteObserver,
        {
          quote,
          paymentPreimage: paymentData.paymentPreimage,
        },
        { scope: { id: `spark-send-quote-${quote.id}` } },
      );
    },
    onFailed: (quote, failureReason) => {
      dispatch(
        failSendQuoteObserver,
        { quoteId: quote.id, reason: failureReason },
        { scope: { id: `spark-send-quote-${quote.id}` } },
      );
    },
  });

  let workSetObserver: QueryObserver<SparkSendQuote[]> | null = null;
  let unsubscribeWorkSet: (() => void) | null = null;
  let lastWorkSet: SparkSendQuote[] | undefined;

  // Mirrors the web's useSelectItemsWithOnlineAccount: keep only quotes whose
  // account is currently online (offline-account quotes are not processed).
  const selectOnline = (quotes: SparkSendQuote[]): SparkSendQuote[] =>
    quotes.filter((quote) => {
      const account = accountsCache.get(quote.accountId);
      return account?.isOnline;
    });

  const handleWorkSet = (quotes: SparkSendQuote[]) => {
    // The web's effect re-ran only when the (memoized) quotes array changed
    // reference; query-core's structural sharing keeps the data reference
    // stable across unrelated observer notifications, so gate on that.
    if (quotes === lastWorkSet) {
      return;
    }
    lastWorkSet = quotes;
    tracker.setQuotes(quotes);
  };

  return {
    activate: () => {
      if (workSetObserver) {
        return;
      }

      // The same options the web's useQuery used (the QueryObserver is the
      // reactivity primitive useQuery wraps): the unresolved-spark-send-quotes
      // work set, filtered to online accounts, refetched on focus/reconnect.
      workSetObserver = new QueryObserver<SparkSendQuote[]>(queryClient, {
        ...unresolvedSparkQuotesOptions(),
        refetchOnWindowFocus: 'always',
        refetchOnReconnect: 'always',
        throwOnError: true,
        select: selectOnline,
      });

      unsubscribeWorkSet = workSetObserver.subscribe((result) => {
        handleWorkSet(result.data ?? []);
      });

      handleWorkSet(workSetObserver.getCurrentResult().data ?? []);
    },
    deactivate: () => {
      unsubscribeWorkSet?.();
      unsubscribeWorkSet = null;
      workSetObserver?.destroy();
      workSetObserver = null;
      lastWorkSet = undefined;
      tracker.stop();
    },
  };
}
