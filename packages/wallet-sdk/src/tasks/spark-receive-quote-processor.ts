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
import type { CashuAccount, SparkAccount } from '../accounts/account';
import type { AccountsCache } from '../accounts/accounts-cache';
import { getInitializedCashuWallet } from '../cashu';
import type { SparkReceiveQuote } from '../receive/spark-receive-quote';
import type {
  PendingSparkReceiveQuotesCache,
  SparkReceiveQuoteCache,
} from '../receive/spark-receive-quote-cache';
import type { SparkReceiveQuoteService } from '../receive/spark-receive-quote-service';
import { sparkDebugLog } from '../spark-config';
import { MeltQuoteTracker } from './melt-quote-tracker';
import type { SagaProcessor } from './processor';
import { SparkReceiveTracker } from './spark-receive-tracker';

export type SparkReceiveQuoteProcessorDeps = {
  queryClient: QueryClient;
  /** The spark-receive-quote saga service the transitions call. */
  sparkReceiveQuoteService: SparkReceiveQuoteService;
  /** The active-quote state the complete transition writes back into. */
  sparkReceiveQuoteCache: SparkReceiveQuoteCache;
  /**
   * The pending-quotes state the mutationFns re-read the live entity from and
   * the melt tracker resolves melt quote ids against.
   */
  pendingSparkReceiveQuotesCache: PendingSparkReceiveQuotesCache;
  /** Accounts state: resolves the receiving spark account, the online-account
   * work-set filter, and the melt source wallet (by mint url + currency). */
  accountsCache: AccountsCache;
  /** Eager transaction-cache invalidation on complete (the reconnect hedge). */
  invalidateTransaction: (transactionId: string) => Promise<unknown>;
  /** The query config for the current user's pending spark receive quotes. */
  pendingSparkQuotesOptions: () => {
    queryKey: string[];
    queryFn: () => Promise<SparkReceiveQuote[]>;
    staleTime: number;
  };
};

/**
 * The spark-receive-quote saga processor. While active (leader) it:
 *  - watches the current user's pending spark receive quotes that belong to an
 *    online account (offline-account quotes are not processed);
 *  - drives a {@link SparkReceiveTracker} (one Breez listener per spark account
 *    + the initial getPaymentByInvoice check) to detect paid/expired;
 *  - drives a {@link MeltQuoteTracker} over the CASHU_TOKEN quotes' melt legs;
 *  - on each detected change dispatches the matching transition through a
 *    `MutationObserver`, serialized per quote by scope id, with the retry policy
 *    and onSuccess cache writes each transition needs.
 *
 * Every transition re-reads the live entity from the pending cache and
 * early-returns if it is gone (it was updated in the meantime).
 *
 * The Breez listener this attaches is the LEADER-ONLY saga listener and is
 * distinct from the always-on balance listener `accounts.startSparkBalanceTracking`
 * attaches to the same shared `BreezSdk`; balance tracking is untouched.
 */
export function createSparkReceiveQuoteProcessor(
  deps: SparkReceiveQuoteProcessorDeps,
): SagaProcessor {
  const {
    queryClient,
    sparkReceiveQuoteService,
    sparkReceiveQuoteCache,
    pendingSparkReceiveQuotesCache,
    accountsCache,
    invalidateTransaction,
    pendingSparkQuotesOptions,
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

  const completeReceiveQuoteObserver = new MutationObserver<
    Awaited<ReturnType<SparkReceiveQuoteService['complete']>> | undefined,
    Error,
    { quoteId: string; paymentPreimage: string; sparkTransferId: string }
  >(queryClient, {
    mutationFn: async ({ quoteId, paymentPreimage, sparkTransferId }) => {
      const quote = pendingSparkReceiveQuotesCache.get(quoteId);
      if (!quote) {
        // Quote was updated in the meantime so it's not pending anymore.
        return;
      }
      return sparkReceiveQuoteService.complete(
        quote,
        paymentPreimage,
        sparkTransferId,
      );
    },
    retry: 3,
    throwOnError: true,
    onSuccess: (updatedQuote) => {
      if (updatedQuote) {
        sparkDebugLog('Receive quote completed', {
          quoteId: updatedQuote.id,
          accountId: updatedQuote.accountId,
          transactionId: updatedQuote.transactionId,
        });
        // Updating the quote cache triggers navigation to the transaction details page.
        // Completing the quote also completes the transaction and if navigation to transaction
        // page happens before transaction updated realtime notification is processed, the
        // transaction would be stale in the cache with the DRAFT state. We are invalidating the
        // transaction cache here so that it starts refetching the transaction as soon as possible
        // without relying on realtime notification which might be delayed when reconnecting due to
        // the app being in background.
        invalidateTransaction(updatedQuote.transactionId);
        sparkReceiveQuoteCache.updateIfExists(updatedQuote);
        pendingSparkReceiveQuotesCache.remove(updatedQuote);
      }
    },
    onError: (error, { quoteId }) => {
      console.error('Complete spark receive quote error', {
        cause: error,
        receiveQuoteId: quoteId,
      });
    },
  });

  const expireReceiveQuoteObserver = new MutationObserver<void, Error, string>(
    queryClient,
    {
      mutationFn: async (quoteId) => {
        const quote = pendingSparkReceiveQuotesCache.get(quoteId);
        if (!quote) {
          // Quote was updated in the meantime so it's not pending anymore.
          return;
        }
        await sparkReceiveQuoteService.expire(quote);
      },
      retry: 3,
      throwOnError: true,
      onError: (error, quoteId) => {
        console.error('Expire spark receive quote error', {
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
      const quote = pendingSparkReceiveQuotesCache.get(quoteId);
      if (!quote) {
        // This can happen when the quote was updated in the meantime so it's not pending anymore.
        return;
      }
      await sparkReceiveQuoteService.fail(quote, reason);
    },
    retry: 3,
    throwOnError: true,
    onError: (error, { quoteId }) => {
      console.error('Fail spark receive quote error', {
        cause: error,
        receiveQuoteId: quoteId,
      });
    },
  });

  const initiateMeltObserver = new MutationObserver<void, Error, string>(
    queryClient,
    {
      mutationFn: async (quoteId) => {
        const quote = pendingSparkReceiveQuotesCache.get(quoteId);
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
          // The initiate-melt cascade fails under the `cashu-receive-quote-${id}`
          // scope rather than the spark one (a copy-paste artifact from the
          // cashu-receive family). A latent bug, filed separately, not fixed
          // here.
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
        const quote = pendingSparkReceiveQuotesCache.get(quoteId);
        if (quote?.type !== 'CASHU_TOKEN') {
          // Quote not defined can happen when the quote was updated in the meantime so it's not pending anymore.
          // Quote type not CASHU_TOKEN should never happen.
          return;
        }

        await sparkReceiveQuoteService.markMeltInitiated(quote);
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

  const sparkReceiveTracker = new SparkReceiveTracker({
    getSparkAccount,
    onCompleted: (quoteId, paymentData) => {
      dispatch(
        completeReceiveQuoteObserver,
        {
          quoteId,
          paymentPreimage: paymentData.paymentPreimage,
          sparkTransferId: paymentData.sparkTransferId,
        },
        { scope: { id: `spark-receive-quote-${quoteId}` } },
      );
    },
    onExpired: (quoteId) => {
      dispatch(expireReceiveQuoteObserver, quoteId, {
        scope: { id: `spark-receive-quote-${quoteId}` },
      });
    },
  });

  const meltSubscriptionManager = new MeltQuoteSubscriptionManager();

  const meltQuoteTracker = new MeltQuoteTracker({
    subscriptionManager: meltSubscriptionManager,
    getWallet: (mintUrl, currency): ExtendedCashuWallet => {
      const sourceAccount = getCashuAccountByMintUrlAndCurrency(
        mintUrl,
        currency,
      );
      return sourceAccount ? sourceAccount.wallet : getCashuWallet(mintUrl);
    },
    onUnpaid: (meltQuote) => {
      const receiveQuote = pendingSparkReceiveQuotesCache.getByMeltQuoteId(
        meltQuote.quote,
      );
      if (!receiveQuote) {
        return;
      }

      if (receiveQuote.tokenReceiveData.meltInitiated) {
        // If melt was initiated but the quote is again in the unpaid state, it means that the melt failed.
        // The melt-path scope `spark-receive-quote${id}` is MISSING the hyphen
        // the spark-path scope `spark-receive-quote-${id}` has, so the two paths
        // are not serialized against each other. A latent bug, filed separately,
        // not fixed here.
        dispatch(
          failReceiveQuoteObserver,
          { quoteId: receiveQuote.id, reason: 'Cashu token melt failed.' },
          { scope: { id: `spark-receive-quote${receiveQuote.id}` } },
        );
      } else {
        dispatch(initiateMeltObserver, receiveQuote.id, {
          scope: { id: `spark-receive-quote${receiveQuote.id}` },
        });
      }
    },
    onPending: (meltQuote) => {
      const receiveQuote = pendingSparkReceiveQuotesCache.getByMeltQuoteId(
        meltQuote.quote,
      );
      if (!receiveQuote) {
        return;
      }

      dispatch(markMeltInitiatedObserver, receiveQuote.id, {
        scope: { id: `spark-receive-quote${receiveQuote.id}` },
      });
    },
    onExpired: (meltQuote) => {
      const receiveQuote = pendingSparkReceiveQuotesCache.getByMeltQuoteId(
        meltQuote.quote,
      );
      if (!receiveQuote) {
        return;
      }

      dispatch(expireReceiveQuoteObserver, receiveQuote.id, {
        scope: { id: `spark-receive-quote${receiveQuote.id}` },
      });
    },
  });

  let workSetObserver: QueryObserver<SparkReceiveQuote[]> | null = null;
  let unsubscribeWorkSet: (() => void) | null = null;
  let lastWorkSet: SparkReceiveQuote[] | undefined;

  // Keep only quotes whose account is currently online (offline-account
  // quotes are not processed).
  const selectOnline = (quotes: SparkReceiveQuote[]): SparkReceiveQuote[] =>
    quotes.filter((quote) => {
      const account = accountsCache.get(quote.accountId);
      return account?.isOnline;
    });

  // Map to the melt-quote work set (CASHU_TOKEN quotes only).
  const toMeltQuoteWorkSet = (quotes: SparkReceiveQuote[]) =>
    quotes
      .filter(
        (q): q is SparkReceiveQuote & { type: 'CASHU_TOKEN' } =>
          q.type === 'CASHU_TOKEN',
      )
      .map((q) => ({
        id: q.tokenReceiveData.meltQuoteId,
        mintUrl: q.tokenReceiveData.sourceMintUrl,
        currency: q.tokenReceiveData.tokenAmount.currency,
        expiryInMs: new Date(q.expiresAt).getTime(),
        inputAmount: sumProofs(q.tokenReceiveData.tokenProofs),
      }));

  // Map every pending quote to the spark tracker's work item (invoice + payment
  // hash for matching, expiry for the synced sweep).
  const toSparkWorkSet = (quotes: SparkReceiveQuote[]) =>
    quotes.map((q) => ({
      id: q.id,
      accountId: q.accountId,
      paymentRequest: q.paymentRequest,
      paymentHash: q.paymentHash,
      expiresAt: q.expiresAt,
    }));

  const handleWorkSet = (quotes: SparkReceiveQuote[]) => {
    // Only re-run the trackers when the quotes array actually changed:
    // query-core's structural sharing keeps the data reference stable across
    // unrelated observer notifications, so gate on reference equality.
    if (quotes === lastWorkSet) {
      return;
    }
    lastWorkSet = quotes;
    sparkReceiveTracker.setQuotes(toSparkWorkSet(quotes));
    meltQuoteTracker.setQuotes(toMeltQuoteWorkSet(quotes));
  };

  return {
    activate: () => {
      if (workSetObserver) {
        return;
      }

      // The pending-spark-receive-quotes work set, filtered to online
      // accounts, refetched on focus/reconnect.
      workSetObserver = new QueryObserver<SparkReceiveQuote[]>(queryClient, {
        ...pendingSparkQuotesOptions(),
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
      sparkReceiveTracker.stop();
      meltQuoteTracker.stop();
    },
  };
}
