import {
  type ExtendedCashuWallet,
  MintQuoteSubscriptionManager,
  getCashuUnit,
  getCashuWallet,
  sumProofs,
} from '@agicash/cashu';
import type { Money } from '@agicash/utils/money';
import {
  type LongTimeout,
  clearLongTimeout,
  setLongTimeout,
} from '@agicash/utils/timeout';
import type { CashuAccount } from '@agicash/wallet-sdk/accounts/account';
import { getInitializedCashuWallet } from '@agicash/wallet-sdk/cashu';
import type { CashuReceiveQuote } from '@agicash/wallet-sdk/receive/cashu-receive-quote';
import type { TransactionPurpose } from '@agicash/wallet-sdk/transactions/transaction-enums';
import {
  HttpResponseError,
  MintOperationError,
  type MintQuoteBolt11Response,
  NetworkError,
  type WebSocketSupport,
} from '@cashu/cashu-ts';
import {
  type Query,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOnMeltQuoteStateChange } from '~/lib/cashu/melt-quote-subscription';
import { useLatest } from '~/lib/use-latest';
import { withRetry } from '~/lib/with-retry';
import {
  useGetCashuAccount,
  useGetCashuAccountByMintUrlAndCurrency,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import { getSdk } from '../shared/sdk';

type CreateProps = {
  account: CashuAccount;
  amount: Money;
  description?: string;
  purpose?: TransactionPurpose;
  transferId?: string;
};

/**
 * Transitional (sdk.receive.internal): only for the web-owned realtime wiring
 * and task processing until the background task processing moves into the SDK (the MCP phase).
 */
export function usePendingCashuReceiveQuotesCache() {
  return getSdk().receive.internal.pendingCashuReceiveQuotesCache;
}

/**
 * Transitional (sdk.receive.internal): only for the web-owned realtime wiring
 * and task processing until the background task processing moves into the SDK (the MCP phase).
 */
export function useCashuReceiveQuoteCache() {
  return getSdk().receive.internal.cashuReceiveQuoteCache;
}

export function useCreateCashuReceiveQuote() {
  return useMutation({
    scope: {
      id: 'create-cashu-receive-quote',
    },
    mutationFn: (props: CreateProps) =>
      getSdk().receive.createCashuReceiveQuote(props),
    retry: 1,
  });
}

type UseTrackCashuReceiveQuoteProps = {
  quoteId?: string;
  onPaid?: (quote: CashuReceiveQuote) => void;
  onExpired?: (quote: CashuReceiveQuote) => void;
};

type UseTrackCashuReceiveQuoteResponse =
  | {
      status: 'LOADING';
      quote?: undefined;
    }
  | {
      status: CashuReceiveQuote['state'];
      quote: CashuReceiveQuote;
    };

export function useTrackCashuReceiveQuote({
  quoteId,
  onPaid,
  onExpired,
}: UseTrackCashuReceiveQuoteProps): UseTrackCashuReceiveQuoteResponse {
  const enabled = !!quoteId;
  const onPaidRef = useLatest(onPaid);
  const onExpiredRef = useLatest(onExpired);

  const { data } = useQuery({
    ...getSdk().receive.cashuQuoteOptions(quoteId),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    enabled,
  });

  useEffect(() => {
    if (!data) return;

    if (data.state === 'COMPLETED') {
      onPaidRef.current?.(data);
    } else if (data.state === 'EXPIRED') {
      onExpiredRef.current?.(data);
    }
  }, [data]);

  if (!data) {
    return { status: 'LOADING' };
  }

  return {
    status: data.state,
    quote: data,
  };
}

const usePendingCashuReceiveQuotes = () => {
  const selectReceiveQuotesWithOnlineAccount =
    useSelectItemsWithOnlineAccount();

  const { data } = useQuery({
    ...getSdk().receive.pendingCashuQuotesOptions(),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    throwOnError: true,
    select: selectReceiveQuotesWithOnlineAccount,
  });

  return data ?? [];
};

const usePendingMeltQuotes = (
  pendingCashuReceiveQuotes: CashuReceiveQuote[],
) => {
  return useMemo(
    () =>
      pendingCashuReceiveQuotes
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
        })),
    [pendingCashuReceiveQuotes],
  );
};

const checkIfMintSupportsWebSocketsForMintQuotes = (
  account: CashuAccount,
  currency: string,
): boolean => {
  const nut17Info = account.wallet.getMintInfo().isSupported(17);
  const params = nut17Info.params ?? [];
  const supportsWebSocketsForMintQuotes =
    nut17Info.supported &&
    params.some(
      (support: WebSocketSupport) =>
        support.method === 'bolt11' &&
        account.currency === currency &&
        support.commands.includes('bolt11_mint_quote'),
    );

  return supportsWebSocketsForMintQuotes;
};

type TrackMintQuotesWithPollingProps = {
  quotes: CashuReceiveQuote[];
  onFetched: (mintQuoteResponse: MintQuoteBolt11Response) => void;
};

/**
 * Polls the state of the provided mint quotes.
 */
const useTrackMintQuotesWithPolling = ({
  quotes,
  onFetched,
}: TrackMintQuotesWithPollingProps) => {
  const getCashuAccount = useGetCashuAccount();

  useQueries({
    queries: quotes.map((quote) => ({
      queryKey: ['mint-quote', quote.quoteId],
      queryFn: async () => {
        try {
          const account = getCashuAccount(quote.accountId);
          const mintQuoteResponse = await account.wallet.checkMintQuoteBolt11(
            quote.quoteId,
          );

          onFetched(mintQuoteResponse);

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
    })),
  });
};

type TrackMintQuotesWithWebSocketProps = {
  quotesByMint: Record<string, CashuReceiveQuote[]>;
  onUpdate: (mintQuoteResponse: MintQuoteBolt11Response) => void;
};

/**
 * Subscribes to the mint quotes updates using web socket.
 */
const useTrackMintQuotesWithWebSocket = ({
  quotesByMint,
  onUpdate,
}: TrackMintQuotesWithWebSocketProps) => {
  const getCashuAccount = useGetCashuAccount();
  const [subscriptionManager] = useState(
    () => new MintQuoteSubscriptionManager(),
  );
  const { mutate: subscribe } = useMutation({
    mutationFn: (props: Parameters<typeof subscriptionManager.subscribe>[0]) =>
      subscriptionManager.subscribe(props),
    retry: 5,
    onError: (error, variables) => {
      console.error('Error subscribing to mint quote updates', {
        mintUrl: variables.mintUrl,
        cause: error,
      });
    },
  });

  useEffect(() => {
    Object.entries(quotesByMint).map(([mintUrl, quotes]) =>
      subscribe({ mintUrl, quoteIds: quotes.map((q) => q.quoteId), onUpdate }),
    );
  }, [subscribe, quotesByMint, onUpdate]);

  const getMintQuote = useCallback(
    (receiveQuote: CashuReceiveQuote) =>
      withRetry({
        fn: () => {
          const account = getCashuAccount(receiveQuote.accountId);
          return account.wallet.checkMintQuoteBolt11(receiveQuote.quoteId);
        },
        retry: 5,
      }),
    [getCashuAccount],
  );

  useEffect(() => {
    // For unpaid receive quotes, we need to check the state of the mint's quote upon expiration because
    // there is no state change for the expiration so socket will not notify us. We don't need to do this
    // for other states besides unpaid because for those we are sure that the quote hasn't expired.
    if (Object.keys(quotesByMint).length === 0) return;

    const unpaidReceiveQuotes = Object.entries(quotesByMint)
      .flatMap(([_, quotes]) => quotes)
      .filter((quote) => quote.state === 'UNPAID');

    const timeouts: LongTimeout[] = [];

    for (const receiveQuote of unpaidReceiveQuotes) {
      const expiresAt = new Date(receiveQuote.expiresAt);
      const msUntilExpiration = expiresAt.getTime() - Date.now();

      const quoteTimeout = setLongTimeout(async () => {
        try {
          const mintQuote = await getMintQuote(receiveQuote);
          return onUpdate(mintQuote);
        } catch (error) {
          console.error('Error checking mint quote upon expiration', {
            cause: error,
          });
        }
      }, msUntilExpiration);

      timeouts.push(quoteTimeout);
    }

    return () => {
      timeouts.forEach((timeout) => clearLongTimeout(timeout));
    };
  }, [quotesByMint, getMintQuote, onUpdate]);
};

const usePartitionQuotesByStateCheckType = ({
  quotes,
}: { quotes: CashuReceiveQuote[] }) => {
  const getCashuAccount = useGetCashuAccount();

  return useMemo(() => {
    const quotesToSubscribeTo: Record<string, CashuReceiveQuote[]> = {};
    const quotesToPoll: CashuReceiveQuote[] = [];

    quotes.forEach((quote) => {
      const account = getCashuAccount(quote.accountId);

      const mintSupportsWebSockets = checkIfMintSupportsWebSocketsForMintQuotes(
        account,
        account.currency,
      );

      if (mintSupportsWebSockets) {
        const quotesForMint = quotesToSubscribeTo[account.mintUrl] ?? [];
        quotesToSubscribeTo[account.mintUrl] = quotesForMint.concat(quote);
      } else {
        quotesToPoll.push(quote);
      }
    });

    return { quotesToSubscribeTo, quotesToPoll };
  }, [quotes, getCashuAccount]);
};

type OnMintQuoteStateChangeProps = {
  quotes: CashuReceiveQuote[];
  onPaid: (quoteId: string) => void;
  onIssued: (quoteId: string) => void;
  onExpired: (quoteId: string) => void;
};

/**
 * Tracks the state of the mint quotes. It uses web socket for the mints that support it and polling for the rest.
 */
const useOnMintQuoteStateChange = ({
  quotes,
  onPaid,
  onIssued,
  onExpired,
}: OnMintQuoteStateChangeProps) => {
  const onPaidRef = useLatest(onPaid);
  const onIssuedRef = useLatest(onIssued);
  const onExpiredRef = useLatest(onExpired);
  const pendingQuotesCache = usePendingCashuReceiveQuotesCache();

  const processMintQuote = useCallback(
    async (mintQuote: MintQuoteBolt11Response) => {
      const relatedReceiveQuote = pendingQuotesCache.getByMintQuoteId(
        mintQuote.quote,
      );

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
        onExpiredRef.current(relatedReceiveQuote.id);
      } else if (mintQuote.state === 'PAID') {
        onPaidRef.current(relatedReceiveQuote.id);
      } else if (mintQuote.state === 'ISSUED') {
        onIssuedRef.current(relatedReceiveQuote.id);
      }
    },
    [pendingQuotesCache],
  );

  const { quotesToSubscribeTo, quotesToPoll } =
    usePartitionQuotesByStateCheckType({ quotes });

  useTrackMintQuotesWithWebSocket({
    quotesByMint: quotesToSubscribeTo,
    onUpdate: processMintQuote,
  });

  useTrackMintQuotesWithPolling({
    quotes: quotesToPoll,
    onFetched: processMintQuote,
  });
};

export function useProcessCashuReceiveQuoteTasks() {
  const cashuReceiveQuoteService =
    getSdk().receive.internal.cashuReceiveQuoteService;
  const pendingCashuReceiveQuotes = usePendingCashuReceiveQuotes();
  const pendingMeltQuotes = usePendingMeltQuotes(pendingCashuReceiveQuotes);
  const getCashuAccount = useGetCashuAccount();
  const getCashuAccountByMintUrlAndCurrency =
    useGetCashuAccountByMintUrlAndCurrency();
  const pendingQuotesCache = usePendingCashuReceiveQuotesCache();
  const cashuReceiveQuoteCache = useCashuReceiveQuoteCache();
  const queryClient = useQueryClient();

  const { mutate: completeReceiveQuote } = useMutation({
    mutationFn: async (quoteId: string) => {
      const quote = pendingQuotesCache.get(quoteId);
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
        getSdk().transactions.invalidate(data.quote.transactionId);
        cashuReceiveQuoteCache.updateIfExists(data.quote);
        pendingQuotesCache.update(data.quote);
      }
    },
    onError: (error, quoteId) => {
      console.error('Complete cashu receive quote error', {
        cause: error,
        receiveQuoteId: quoteId,
      });
    },
  });

  const { mutate: expireReceiveQuote } = useMutation({
    mutationFn: async (quoteId: string) => {
      const quote = pendingQuotesCache.get(quoteId);
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
  });

  const { mutate: failReceiveQuote } = useMutation({
    mutationFn: async ({
      quoteId,
      reason,
    }: { quoteId: string; reason: string }) => {
      const quote = pendingQuotesCache.get(quoteId);
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

  const { mutate: initiateMelt } = useMutation({
    mutationFn: async (quoteId: string) => {
      const quote = pendingQuotesCache.get(quoteId);
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
        failReceiveQuote(
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
  });

  const { mutate: markMeltInitiated } = useMutation({
    mutationFn: async (quoteId: string) => {
      const quote = pendingQuotesCache.get(quoteId);
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
  });

  useOnMintQuoteStateChange({
    quotes: pendingCashuReceiveQuotes,
    onPaid: (quoteId) => {
      completeReceiveQuote(quoteId, {
        scope: { id: `cashu-receive-quote-${quoteId}` },
      });
    },
    onIssued: (quoteId) => {
      // We need to call completeReceiveQuote again here because, when the complete is triggered from the onPaid callback, there could be some issue
      // that causes switching the receive quote state to COMPLETED to fail after minting the proofs (e.g. user killed the browser before that was
      // executed). When that happpens, next time when the app is opened, the mint quote will have state ISSUED so this callback will be called and
      // we need to call completeReceiveQuote again to finish the process.
      completeReceiveQuote(quoteId, {
        scope: { id: `cashu-receive-quote-${quoteId}` },
      });
    },
    onExpired: (quoteId) => {
      expireReceiveQuote(quoteId, {
        scope: { id: `cashu-receive-quote-${quoteId}` },
      });
    },
  });

  useOnMeltQuoteStateChange({
    quotes: pendingMeltQuotes,
    getWallet: (mintUrl, currency) => {
      const sourceAccount = getCashuAccountByMintUrlAndCurrency(
        mintUrl,
        currency,
      );
      return sourceAccount ? sourceAccount.wallet : getCashuWallet(mintUrl);
    },
    onUnpaid: (meltQuote) => {
      const receiveQuote = pendingQuotesCache.getByMeltQuoteId(meltQuote.quote);
      if (!receiveQuote) {
        return;
      }

      if (receiveQuote.tokenReceiveData.meltInitiated) {
        // If melt was initiated but the quote is again in the unpaid state, it means that the melt failed.
        failReceiveQuote(
          { quoteId: receiveQuote.id, reason: 'Cashu token melt failed.' },
          { scope: { id: `cashu-receive-quote-${receiveQuote.id}` } },
        );
      } else {
        initiateMelt(receiveQuote.id, {
          scope: { id: `cashu-receive-quote-${receiveQuote.id}` },
        });
      }
    },
    onPending: (meltQuote) => {
      const receiveQuote = pendingQuotesCache.getByMeltQuoteId(meltQuote.quote);
      if (!receiveQuote) {
        return;
      }

      markMeltInitiated(receiveQuote.id, {
        scope: { id: `cashu-receive-quote-${receiveQuote.id}` },
      });
    },
    onExpired: (meltQuote) => {
      const receiveQuote = pendingQuotesCache.getByMeltQuoteId(meltQuote.quote);
      if (!receiveQuote) {
        return;
      }

      expireReceiveQuote(receiveQuote.id, {
        scope: { id: `cashu-receive-quote-${receiveQuote.id}` },
      });
    },
  });
}
