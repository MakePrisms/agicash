import {
  type ExtendedCashuWallet,
  MeltQuoteSubscriptionManager,
  getCashuUnit,
  getCashuWallet,
  sumProofs,
} from '@agicash/cashu';
import type { Currency } from '@agicash/utils/money';
import { MintOperationError, NetworkError } from '@cashu/cashu-ts';
import {
  MutationObserver,
  type MutationScope,
  type QueryClient,
  QueryObserver,
} from '@tanstack/query-core';
import type { CashuAccount } from '../accounts/account';
import type { AccountsCache } from '../accounts/accounts-cache';
import { getInitializedCashuWallet } from '../cashu';
import type { CashuReceiveQuote } from '../receive/cashu-receive-quote';
import type {
  CashuReceiveQuoteCache,
  PendingCashuReceiveQuotesCache,
} from '../receive/cashu-receive-quote-cache';
import type { CashuReceiveQuoteService } from '../receive/cashu-receive-quote-service';
import { MeltQuoteTracker } from './melt-quote-tracker';
import { MintQuoteTracker } from './mint-quote-tracker';
import type { SagaProcessor } from './processor';

export type CashuReceiveQuoteProcessorDeps = {
  queryClient: QueryClient;
  /** The receive-quote saga service the transitions call. */
  cashuReceiveQuoteService: CashuReceiveQuoteService;
  /** The active-quote state the completeReceive transition writes back into. */
  cashuReceiveQuoteCache: CashuReceiveQuoteCache;
  /**
   * The pending-quotes state the mutationFns re-read the live entity from and
   * the trackers resolve mint/melt quote ids against.
   */
  pendingCashuReceiveQuotesCache: PendingCashuReceiveQuotesCache;
  /** Accounts state: resolves the receiving account, the online-account work-set
   * filter, and the melt source wallet (by mint url + currency). */
  accountsCache: AccountsCache;
  /** Eager transaction-cache invalidation on complete (the reconnect hedge). */
  invalidateTransaction: (transactionId: string) => Promise<unknown>;
  /** The query config for the current user's pending cashu receive quotes. */
  pendingCashuQuotesOptions: () => {
    queryKey: string[];
    queryFn: () => Promise<CashuReceiveQuote[]>;
    staleTime: number;
  };
};

/**
 * The headless cashu-receive-quote saga processor — a behavior-preserving lift
 * of the web's `useProcessCashuReceiveQuoteTasks`. While active (leader) it:
 *  - watches the current user's pending cashu receive quotes that belong to an
 *    online cashu account (the same `select` the web's
 *    `useSelectItemsWithOnlineAccount` applied);
 *  - drives a {@link MintQuoteTracker} (WS for NUT-17 mints + polling fallback +
 *    expiry timers) over those quotes to detect mint-side paid/issued/expired;
 *  - drives a {@link MeltQuoteTracker} over the CASHU_TOKEN quotes' melt legs;
 *  - on each detected change dispatches the matching transition through a
 *    query-core `MutationObserver` with the SAME scope ids, retry policy, and
 *    onSuccess cache-write discipline the web mutations used.
 *
 * Every transition re-reads the live entity from the pending cache and
 * early-returns if it is gone ("updated in the meantime"), exactly as the web
 * mutationFns did.
 */
export function createCashuReceiveQuoteProcessor(
  deps: CashuReceiveQuoteProcessorDeps,
): SagaProcessor {
  const {
    queryClient,
    cashuReceiveQuoteService,
    cashuReceiveQuoteCache,
    pendingCashuReceiveQuotesCache,
    accountsCache,
    invalidateTransaction,
    pendingCashuQuotesOptions,
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

  const completeReceiveQuoteObserver = new MutationObserver<
    | Awaited<ReturnType<CashuReceiveQuoteService['completeReceive']>>
    | undefined,
    Error,
    string
  >(queryClient, {
    mutationFn: async (quoteId) => {
      const quote = pendingCashuReceiveQuotesCache.get(quoteId);
      if (!quote) {
        // This can happen when the quote was updated in the meantime so it's not pending anymore.
        return;
      }
      const account = getCashuAccount(quote.accountId);
      return await cashuReceiveQuoteService.completeReceive(account, quote);
    },
    retry: 3,
    throwOnError: true,
    onSuccess: (data) => {
      if (data) {
        // Updating the quote cache triggers navigation to the transaction details page.
        // Completing the quote also completes the transaction and if navigation to transaction
        // page happens before transaction udpated realtime notification is processed, the
        // transaction would be stale in the cache with the DRAFT state. We are invalidating the
        // transaction cache here so that it starts refetching the transaction as soon as possible
        // without relying on realtime notification which might be delayed when reconnecting due to
        // the app being in background.
        invalidateTransaction(data.quote.transactionId);
        cashuReceiveQuoteCache.updateIfExists(data.quote);
        pendingCashuReceiveQuotesCache.update(data.quote);
      }
    },
    onError: (error, quoteId) => {
      console.error('Complete cashu receive quote error', {
        cause: error,
        receiveQuoteId: quoteId,
      });
    },
  });

  const expireReceiveQuoteObserver = new MutationObserver<void, Error, string>(
    queryClient,
    {
      mutationFn: async (quoteId) => {
        const quote = pendingCashuReceiveQuotesCache.get(quoteId);
        if (!quote) {
          // This can happen when the quote was updated in the meantime so it's not pending anymore.
          return;
        }
        await cashuReceiveQuoteService.expire(quote);
      },
      retry: 3,
      throwOnError: true,
      onError: (error, quoteId) => {
        console.error('Expire cashu receive quote error', {
          cause: error,
          receiveQuoteId: quoteId,
        });
      },
    },
  );

  const failReceiveQuoteObserver = new MutationObserver<
    void,
    Error,
    { quoteId: string; reason: string }
  >(queryClient, {
    mutationFn: async ({ quoteId, reason }) => {
      const quote = pendingCashuReceiveQuotesCache.get(quoteId);
      if (!quote) {
        // This can happen when the quote was updated in the meantime so it's not pending anymore.
        return;
      }
      await cashuReceiveQuoteService.fail(quote, reason);
    },
    retry: 3,
    throwOnError: true,
    onError: (error, { quoteId }) => {
      console.error('Fail cashu receive quote error', {
        cause: error,
        receiveQuoteId: quoteId,
      });
    },
  });

  const initiateMeltObserver = new MutationObserver<void, Error, string>(
    queryClient,
    {
      mutationFn: async (quoteId) => {
        const quote = pendingCashuReceiveQuotesCache.get(quoteId);
        if (quote?.type !== 'CASHU_TOKEN') {
          // Quote not defined can happen when the quote was updated in the meantime so it's not pending anymore.
          // Quote type not CASHU_TOKEN should never happen.
          return;
        }

        const cashuUnit = getCashuUnit(quote.amount.currency);
        const sourceMintUrl = quote.tokenReceiveData.sourceMintUrl;
        const sourceAccount = getCashuAccountByMintUrlAndCurrency(
          sourceMintUrl,
          quote.tokenReceiveData.tokenAmount.currency,
        );

        let sourceWallet: ExtendedCashuWallet;
        if (sourceAccount) {
          sourceWallet = sourceAccount.wallet;
        } else {
          const { wallet, isOnline } = await getInitializedCashuWallet({
            queryClient,
            mintUrl: sourceMintUrl,
            currency: quote.tokenReceiveData.tokenAmount.currency,
          });
          if (!isOnline) throw new NetworkError('Source mint is offline');
          sourceWallet = wallet;
        }

        await sourceWallet.meltProofsIdempotent(
          {
            quote: quote.tokenReceiveData.meltQuoteId,
            amount: quote.amount.toNumber(cashuUnit),
          },
          quote.tokenReceiveData.tokenProofs,
          undefined,
          // See claim-cashu-token-service.ts for rationale on random outputs.
          { type: 'random' },
        );
      },
      retry: (failureCount, error) => {
        if (error instanceof MintOperationError) {
          return false;
        }
        return failureCount < 3;
      },
      onError: (error, quoteId) => {
        if (error instanceof MintOperationError) {
          console.warn('Failed to initiate melt.', {
            cause: error,
            receiveQuoteId: quoteId,
          });
          dispatch(
            failReceiveQuoteObserver,
            {
              quoteId,
              reason: error.message,
            },
            { scope: { id: `cashu-receive-quote-${quoteId}` } },
          );
        } else {
          console.error('Initiate melt error', {
            cause: error,
            receiveQuoteId: quoteId,
          });
        }
      },
    },
  );

  const markMeltInitiatedObserver = new MutationObserver<void, Error, string>(
    queryClient,
    {
      mutationFn: async (quoteId) => {
        const quote = pendingCashuReceiveQuotesCache.get(quoteId);
        if (quote?.type !== 'CASHU_TOKEN') {
          // Quote not defined can happen when the quote was updated in the meantime so it's not pending anymore.
          // Quote type not CASHU_TOKEN should never happen.
          return;
        }

        await cashuReceiveQuoteService.markMeltInitiated(quote);
      },
      retry: 3,
      onError: (error, quoteId) => {
        console.error('Mark melt initiated error', {
          cause: error,
          receiveQuoteId: quoteId,
        });
      },
    },
  );

  const mintQuoteTracker = new MintQuoteTracker({
    queryClient,
    resolveQuote: (mintQuoteId) =>
      pendingCashuReceiveQuotesCache.getByMintQuoteId(mintQuoteId),
    onPaid: (quoteId) => {
      dispatch(completeReceiveQuoteObserver, quoteId, {
        scope: { id: `cashu-receive-quote-${quoteId}` },
      });
    },
    onIssued: (quoteId) => {
      // We need to call completeReceiveQuote again here because, when the complete is triggered from the onPaid callback, there could be some issue
      // that causes switching the receive quote state to COMPLETED to fail after minting the proofs (e.g. user killed the browser before that was
      // executed). When that happpens, next time when the app is opened, the mint quote will have state ISSUED so this callback will be called and
      // we need to call completeReceiveQuote again to finish the process.
      dispatch(completeReceiveQuoteObserver, quoteId, {
        scope: { id: `cashu-receive-quote-${quoteId}` },
      });
    },
    onExpired: (quoteId) => {
      dispatch(expireReceiveQuoteObserver, quoteId, {
        scope: { id: `cashu-receive-quote-${quoteId}` },
      });
    },
  });

  const meltSubscriptionManager = new MeltQuoteSubscriptionManager();

  const meltQuoteTracker = new MeltQuoteTracker({
    queryClient,
    subscriptionManager: meltSubscriptionManager,
    getWallet: (mintUrl, currency): ExtendedCashuWallet => {
      const sourceAccount = getCashuAccountByMintUrlAndCurrency(
        mintUrl,
        currency,
      );
      return sourceAccount ? sourceAccount.wallet : getCashuWallet(mintUrl);
    },
    onUnpaid: (meltQuote) => {
      const receiveQuote = pendingCashuReceiveQuotesCache.getByMeltQuoteId(
        meltQuote.quote,
      );
      if (!receiveQuote) {
        return;
      }

      if (receiveQuote.tokenReceiveData.meltInitiated) {
        // If melt was initiated but the quote is again in the unpaid state, it means that the melt failed.
        dispatch(
          failReceiveQuoteObserver,
          { quoteId: receiveQuote.id, reason: 'Cashu token melt failed.' },
          { scope: { id: `cashu-receive-quote-${receiveQuote.id}` } },
        );
      } else {
        dispatch(initiateMeltObserver, receiveQuote.id, {
          scope: { id: `cashu-receive-quote-${receiveQuote.id}` },
        });
      }
    },
    onPending: (meltQuote) => {
      const receiveQuote = pendingCashuReceiveQuotesCache.getByMeltQuoteId(
        meltQuote.quote,
      );
      if (!receiveQuote) {
        return;
      }

      dispatch(markMeltInitiatedObserver, receiveQuote.id, {
        scope: { id: `cashu-receive-quote-${receiveQuote.id}` },
      });
    },
    onExpired: (meltQuote) => {
      const receiveQuote = pendingCashuReceiveQuotesCache.getByMeltQuoteId(
        meltQuote.quote,
      );
      if (!receiveQuote) {
        return;
      }

      dispatch(expireReceiveQuoteObserver, receiveQuote.id, {
        scope: { id: `cashu-receive-quote-${receiveQuote.id}` },
      });
    },
  });

  let workSetObserver: QueryObserver<CashuReceiveQuote[]> | null = null;
  let unsubscribeWorkSet: (() => void) | null = null;
  let lastWorkSet: CashuReceiveQuote[] | undefined;

  // Mirrors the web's useSelectItemsWithOnlineAccount: keep only quotes whose
  // account is currently online (offline-account quotes are not processed).
  const selectOnline = (quotes: CashuReceiveQuote[]): CashuReceiveQuote[] =>
    quotes.filter((quote) => {
      const account = accountsCache.get(quote.accountId);
      return account?.isOnline;
    });

  // Mirrors the web's usePendingMeltQuotes mapping (CASHU_TOKEN quotes only).
  const toMeltQuoteWorkSet = (quotes: CashuReceiveQuote[]) =>
    quotes
      .filter(
        (q): q is CashuReceiveQuote & { type: 'CASHU_TOKEN' } =>
          q.type === 'CASHU_TOKEN',
      )
      .map((q) => ({
        id: q.tokenReceiveData.meltQuoteId,
        mintUrl: q.tokenReceiveData.sourceMintUrl,
        currency: q.tokenReceiveData.tokenAmount.currency,
        expiryInMs: new Date(q.expiresAt).getTime(),
        inputAmount: sumProofs(q.tokenReceiveData.tokenProofs),
      }));

  // Mirrors the web's mint-quote work-set (every pending quote, its receiving
  // account resolved for the WS/poll/expiry partition).
  const toMintQuoteWorkSet = (quotes: CashuReceiveQuote[]) =>
    quotes.map((q) => ({
      quoteId: q.quoteId,
      account: getCashuAccount(q.accountId),
      state: q.state,
      expiryInMs: new Date(q.expiresAt).getTime(),
    }));

  const handleWorkSet = (quotes: CashuReceiveQuote[]) => {
    // The web's effects re-ran only when the (memoized) quotes array changed
    // reference; query-core's structural sharing keeps the data reference
    // stable across unrelated observer notifications, so gate on that.
    if (quotes === lastWorkSet) {
      return;
    }
    lastWorkSet = quotes;
    mintQuoteTracker.setQuotes(toMintQuoteWorkSet(quotes));
    meltQuoteTracker.setQuotes(toMeltQuoteWorkSet(quotes));
  };

  return {
    activate: () => {
      if (workSetObserver) {
        return;
      }

      // The same options the web's useQuery used (the QueryObserver is the
      // reactivity primitive useQuery wraps): the pending-receive-quotes work
      // set, filtered to online cashu accounts, refetched on focus/reconnect.
      workSetObserver = new QueryObserver<CashuReceiveQuote[]>(queryClient, {
        ...pendingCashuQuotesOptions(),
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
      mintQuoteTracker.stop();
      meltQuoteTracker.stop();
    },
  };
}
