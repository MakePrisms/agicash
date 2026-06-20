import {
  type ExtendedCashuWallet,
  MeltQuoteSubscriptionManager,
  getCashuWallet,
  sumProofs,
} from '@agicash/cashu';
import type { Currency } from '@agicash/utils/money';
import {
  type MeltQuoteBolt11Response,
  MintOperationError,
} from '@cashu/cashu-ts';
import {
  MutationObserver,
  type MutationScope,
  type QueryClient,
  QueryObserver,
} from '@tanstack/query-core';
import type { Account, CashuAccount } from '../accounts/account';
import type { AccountsCache } from '../accounts/accounts-cache';
import type { CashuSendQuote } from '../send/cashu-send-quote';
import type { UnresolvedCashuSendQuotesCache } from '../send/cashu-send-quote-cache';
import type { CashuSendQuoteService } from '../send/cashu-send-quote-service';
import { MeltQuoteTracker } from './melt-quote-tracker';
import type { SagaProcessor } from './processor';

export type CashuSendQuoteProcessorDeps = {
  queryClient: QueryClient;
  /** The send-quote saga service the transitions call. */
  cashuSendQuoteService: CashuSendQuoteService;
  /** The unresolved-send-quotes state the mutationFns re-read the live entity from. */
  unresolvedCashuSendQuotesCache: UnresolvedCashuSendQuotesCache;
  /**
   * The accounts state: resolves the send account, the online-account work-set
   * filter, and the melt wallet (by mint url + currency).
   */
  accountsCache: AccountsCache;
  /** The query config for the current user's unresolved cashu send quotes. */
  unresolvedCashuQuotesOptions: () => {
    queryKey: string[];
    queryFn: () => Promise<CashuSendQuote[]>;
    staleTime: number;
  };
};

/**
 * The cashu-send-quote saga processor. While active (leader) it:
 *  - watches the current user's unresolved cashu send quotes that belong to an
 *    online cashu account (offline-account quotes are not processed);
 *  - drives a {@link MeltQuoteTracker} over those quotes' mints;
 *  - on each melt-state change dispatches the matching transition through a
 *    `MutationObserver`, serialized per quote by scope id, with the retry policy
 *    and onSuccess cache writes each transition needs.
 *
 * Every transition re-reads the live entity from the unresolved cache and
 * early-returns if it is gone (it was updated in the meantime).
 */
export function createCashuSendQuoteProcessor(
  deps: CashuSendQuoteProcessorDeps,
): SagaProcessor {
  const {
    queryClient,
    cashuSendQuoteService,
    unresolvedCashuSendQuotesCache,
    accountsCache,
    unresolvedCashuQuotesOptions,
  } = deps;

  const getCashuAccount = (id: string): CashuAccount => {
    const account = accountsCache.get(id);
    if (!account) {
      throw new Error(`Account not found for id: ${id}`);
    }
    if (account.type !== 'cashu') {
      throw new Error(`Account with id: ${id} is not of type: cashu`);
    }
    return account;
  };

  const getCashuAccountByMintUrlAndCurrency = (
    mintUrl: string,
    currency: Currency,
  ): CashuAccount | null =>
    accountsCache
      .getAll()
      ?.find(
        (a): a is CashuAccount =>
          a.type === 'cashu' &&
          a.mintUrl === mintUrl &&
          a.currency === currency,
      ) ?? null;

  // Fire-and-forget dispatch: the rejection is swallowed (onError/throwOnError
  // still run); the per-call scope rides in opts.
  function dispatch<TData, TVariables>(
    observer: MutationObserver<TData, Error, TVariables>,
    variables: TVariables,
    options?: { scope?: MutationScope },
  ): void {
    observer.mutate(variables, options).catch(() => undefined);
  }

  // One subscription manager per family so the fail transition's
  // removeQuoteFromSubscription drops the quote from the SAME mint subscription
  // (re-subscribe correctness when the same melt quote is reused for a new send
  // after a failure).
  const subscriptionManager = new MeltQuoteSubscriptionManager();

  const tracker = new MeltQuoteTracker({
    subscriptionManager,
    getWallet: (mintUrl, currency): ExtendedCashuWallet => {
      const sourceAccount = getCashuAccountByMintUrlAndCurrency(
        mintUrl,
        currency,
      );
      return sourceAccount ? sourceAccount.wallet : getCashuWallet(mintUrl);
    },
    onUnpaid: (meltQuote) => {
      const sendQuote = unresolvedCashuSendQuotesCache.getByMeltQuoteId(
        meltQuote.quote,
      );
      if (!sendQuote) {
        return;
      }

      // In case of failed payment the mint will flip the state of the melt quote back to UNPAID.
      // In that case we don't want to initiate the send again so we are only initiating the send if our quote state is also UNPAID which won't be the case if the send was already initiated.
      if (sendQuote.state === 'UNPAID') {
        dispatch(
          initiateSendObserver,
          {
            sendQuoteId: sendQuote.id,
            meltQuote,
          },
          {
            // This mutation has different scope because melt quote state is changed to pending while initiate mutation is still in progress
            // so we need to use a different scope, otherwise markSendQuoteAsPending mutation would wait for initiate to be finished before it can be executed.
            scope: { id: `initiate-cashu-send-quote-${sendQuote.id}` },
          },
        );
      }
    },
    onPending: (meltQuote) => {
      const sendQuote = unresolvedCashuSendQuotesCache.getByMeltQuoteId(
        meltQuote.quote,
      );
      if (!sendQuote) {
        return;
      }

      dispatch(markSendQuoteAsPendingObserver, sendQuote.id, {
        scope: { id: `cashu-send-quote-${sendQuote.id}` },
      });
    },
    onExpired: (meltQuote) => {
      const sendQuote = unresolvedCashuSendQuotesCache.getByMeltQuoteId(
        meltQuote.quote,
      );
      if (!sendQuote) {
        return;
      }

      dispatch(expireSendQuoteObserver, sendQuote.id, {
        scope: { id: `cashu-send-quote-${sendQuote.id}` },
      });
    },
    onPaid: (meltQuote) => {
      const sendQuote = unresolvedCashuSendQuotesCache.getByMeltQuoteId(
        meltQuote.quote,
      );
      if (!sendQuote) {
        return;
      }

      dispatch(
        completeSendQuoteObserver,
        {
          sendQuoteId: sendQuote.id,
          meltQuote,
        },
        { scope: { id: `cashu-send-quote-${sendQuote.id}` } },
      );
    },
  });

  const failSendQuoteObserver = new MutationObserver<
    { mintUrl: string; quoteId: string } | undefined,
    Error,
    { sendQuoteId: string; reason: string }
  >(queryClient, {
    mutationFn: async ({ sendQuoteId, reason }) => {
      const sendQuote = unresolvedCashuSendQuotesCache.get(sendQuoteId);
      if (!sendQuote) {
        // This means that the quote is not pending anymore so it was removed from the cache.
        // This can happen if the quote was completed, failed or expired in the meantime.
        return;
      }

      const account = getCashuAccount(sendQuote.accountId);
      const failedQuote = await cashuSendQuoteService.failSendQuote(
        account,
        sendQuote,
        reason,
      );
      return {
        mintUrl: account.mintUrl,
        quoteId: failedQuote.quoteId,
      };
    },
    retry: 3,
    throwOnError: true,
    onSuccess: (data) => {
      if (data) {
        // This is needed for the case when the user initiates the send again after failure on the confirmation page.
        // In that case we create a new send quote with the same melt quote, but subscriptionManager would still be
        // subscribed to that melt quote so the tracker handler would not be called again for this new
        // send quote so new send quote would not be initiated until next full page reload.
        tracker.removeQuoteFromSubscription(data);
      }
    },
    onError: (error, variables) => {
      console.error('Failed to mark payment as failed', {
        cause: error,
        sendQuoteId: variables.sendQuoteId,
      });
    },
  });

  const initiateSendObserver = new MutationObserver<
    void,
    Error,
    { sendQuoteId: string; meltQuote: MeltQuoteBolt11Response }
  >(queryClient, {
    mutationFn: async ({ sendQuoteId, meltQuote }) => {
      const sendQuote = unresolvedCashuSendQuotesCache.get(sendQuoteId);
      if (!sendQuote) {
        // This means that the quote is not pending anymore so it was removed from the cache.
        // This can happen if the quote was completed, failed or expired in the meantime.
        return;
      }

      const account = getCashuAccount(sendQuote.accountId);

      await cashuSendQuoteService.initiateSend(account, sendQuote, meltQuote);
    },
    retry: (failureCount, error) => {
      if (error instanceof MintOperationError) {
        return false;
      }
      return failureCount < 3;
    },
    throwOnError: true,
    onError: (error, variables) => {
      if (error instanceof MintOperationError) {
        console.warn('Failed to initiate send.', {
          cause: error,
          sendQuoteId: variables.sendQuoteId,
        });
        dispatch(failSendQuoteObserver, {
          sendQuoteId: variables.sendQuoteId,
          reason: error.message,
        });
      } else {
        console.error('Initiate send error', {
          cause: error,
          sendQuoteId: variables.sendQuoteId,
        });
      }
    },
  });

  const markSendQuoteAsPendingObserver = new MutationObserver<
    CashuSendQuote | undefined,
    Error,
    string
  >(queryClient, {
    mutationFn: async (sendQuoteId) => {
      const sendQuote = unresolvedCashuSendQuotesCache.get(sendQuoteId);
      if (!sendQuote) {
        // This means that the quote is not pending anymore so it was removed from the cache.
        // This can happen if the quote was completed, failed or expired in the meantime.
        return;
      }

      return cashuSendQuoteService.markSendQuoteAsPending(sendQuote);
    },
    retry: 3,
    throwOnError: true,
    onSuccess: (quote) => {
      if (quote) {
        unresolvedCashuSendQuotesCache.update(quote);
      }
    },
    onError: (error, sendQuoteId) => {
      console.error('Mark send quote as pending error', {
        cause: error,
        sendQuoteId,
      });
    },
  });

  const expireSendQuoteObserver = new MutationObserver<void, Error, string>(
    queryClient,
    {
      mutationFn: async (sendQuoteId) => {
        const sendQuote = unresolvedCashuSendQuotesCache.get(sendQuoteId);
        if (!sendQuote) {
          // This means that the quote is not pending anymore so it was removed from the cache.
          // This can happen if the quote was completed, failed or expired in the meantime.
          return;
        }

        return cashuSendQuoteService.expireSendQuote(sendQuote);
      },
      retry: 3,
      throwOnError: true,
      onError: (error, sendQuoteId) => {
        console.error('Expire send quote error', {
          cause: error,
          sendQuoteId,
        });
      },
    },
  );

  const completeSendQuoteObserver = new MutationObserver<
    CashuSendQuote | undefined,
    Error,
    { sendQuoteId: string; meltQuote: MeltQuoteBolt11Response }
  >(queryClient, {
    mutationFn: async ({ sendQuoteId, meltQuote }) => {
      const sendQuote = unresolvedCashuSendQuotesCache.get(sendQuoteId);
      if (!sendQuote) {
        // This means that the quote is not pending anymore so it was removed from the cache.
        // This can happen if the quote was completed, failed or expired in the meantime.
        return;
      }

      const account = getCashuAccount(sendQuote.accountId);

      return cashuSendQuoteService.completeSendQuote(
        account,
        sendQuote,
        meltQuote,
      );
    },
    retry: 3,
    throwOnError: true,
    onError: (error, sendQuoteId) => {
      console.error('Complete send quote error', {
        cause: error,
        sendQuoteId,
      });
    },
  });

  let workSetObserver: QueryObserver<CashuSendQuote[]> | null = null;
  let unsubscribeWorkSet: (() => void) | null = null;
  let lastWorkSet: CashuSendQuote[] | undefined;

  // Keep only quotes whose account is currently online (offline-account
  // quotes are not processed).
  const selectOnline = (quotes: CashuSendQuote[]): CashuSendQuote[] =>
    quotes.filter((quote) => {
      const account = accountsCache.get(quote.accountId);
      return account?.isOnline;
    });

  // Map to the melt-quote work set.
  const toMeltQuoteWorkSet = (quotes: CashuSendQuote[]) =>
    quotes.map((q) => {
      const account: Account | null = accountsCache.get(q.accountId);
      if (!account || account.type !== 'cashu') {
        throw new Error(`Cashu account not found for send quote: ${q.id}`);
      }
      return {
        id: q.quoteId,
        mintUrl: account.mintUrl,
        currency: account.currency,
        expiryInMs: new Date(q.expiresAt).getTime(),
        inputAmount: sumProofs(q.proofs),
      };
    });

  const handleWorkSet = (quotes: CashuSendQuote[]) => {
    // Only re-run the tracker when the quotes array actually changed:
    // query-core's structural sharing keeps the data reference stable across
    // unrelated observer notifications, so gate on reference equality.
    if (quotes === lastWorkSet) {
      return;
    }
    lastWorkSet = quotes;
    tracker.setQuotes(toMeltQuoteWorkSet(quotes));
  };

  return {
    activate: () => {
      if (workSetObserver) {
        return;
      }

      // The unresolved-send-quotes work set, filtered to online cashu
      // accounts, refetched on focus/reconnect.
      workSetObserver = new QueryObserver<CashuSendQuote[]>(queryClient, {
        ...unresolvedCashuQuotesOptions(),
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
