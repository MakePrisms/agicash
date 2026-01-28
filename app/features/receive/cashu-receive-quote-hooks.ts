import {
  HttpResponseError,
  MintOperationError,
  type MintQuoteResponse,
  type WebSocketSupport,
} from '@cashu/cashu-ts';
import {
  type Query,
  type QueryClient,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MintQuoteSubscriptionManager,
  getCashuUnit,
  getCashuWallet,
  sumProofs,
  useOnMeltQuoteStateChange,
} from '~/lib/cashu';
import type { Money } from '~/lib/money';
import {
  type LongTimeout,
  clearLongTimeout,
  setLongTimeout,
} from '~/lib/timeout';
import { useLatest } from '~/lib/use-latest';
import type { CashuAccount } from '../accounts/account';
import {
  useGetCashuAccount,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import type { AgicashDbCashuReceiveQuote } from '../agicash-db/database';
import { useUser } from '../user/user-hooks';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import { useCashuReceiveQuoteRepository } from './cashu-receive-quote-repository';
import { useCashuReceiveQuoteService } from './cashu-receive-quote-service';

type CreateProps = {
  account: CashuAccount;
  amount: Money;
  description?: string;
};
class CashuReceiveQuoteCache {
  // Query that tracks the "active" cashu receive quote. Active one is the one that user created in current browser session.
  // We want to track active quote even after it is expired and completed which is why we can't use pending quotes query.
  // Pending quotes query is used for active pending quote plus "background" pending quotes. "Background" quotes are quotes
  // that were created in previous browser sessions.
  public static Key = 'cashu-receive-quote';

  constructor(private readonly queryClient: QueryClient) {}

  get(quoteId: string) {
    return this.queryClient.getQueryData<CashuReceiveQuote>([
      CashuReceiveQuoteCache.Key,
      quoteId,
    ]);
  }

  add(quote: CashuReceiveQuote) {
    this.queryClient.setQueryData<CashuReceiveQuote>(
      [CashuReceiveQuoteCache.Key, quote.id],
      quote,
    );
  }

  updateIfExists(quote: CashuReceiveQuote) {
    this.queryClient.setQueryData<CashuReceiveQuote>(
      [CashuReceiveQuoteCache.Key, quote.id],
      (curr) => (curr && curr.version < quote.version ? quote : undefined),
    );
  }
}

export class PendingCashuReceiveQuotesCache {
  // Query that tracks all pending cashu receive quotes (active and background ones).
  public static Key = 'pending-cashu-receive-quotes';

  constructor(private readonly queryClient: QueryClient) {}

  get(quoteId: string) {
    return this.queryClient
      .getQueryData<CashuReceiveQuote[]>([PendingCashuReceiveQuotesCache.Key])
      ?.find((q) => q.id === quoteId);
  }

  add(quote: CashuReceiveQuote) {
    this.queryClient.setQueryData<CashuReceiveQuote[]>(
      [PendingCashuReceiveQuotesCache.Key],
      (curr) => [...(curr ?? []), quote],
    );
  }

  update(quote: CashuReceiveQuote) {
    this.queryClient.setQueryData<CashuReceiveQuote[]>(
      [PendingCashuReceiveQuotesCache.Key],
      (curr) =>
        curr?.map((q) =>
          q.id === quote.id && q.version < quote.version ? quote : q,
        ),
    );
  }

  remove(quote: CashuReceiveQuote) {
    this.queryClient.setQueryData<CashuReceiveQuote[]>(
      [PendingCashuReceiveQuotesCache.Key],
      (curr) => curr?.filter((q) => q.id !== quote.id),
    );
  }

  getByMintQuoteId(mintQuoteId: string) {
    const quotes = this.queryClient.getQueryData<CashuReceiveQuote[]>([
      PendingCashuReceiveQuotesCache.Key,
    ]);
    return quotes?.find((q) => q.quoteId === mintQuoteId);
  }

  getByMeltQuoteId(
    meltQuoteId: string,
  ): (CashuReceiveQuote & { type: 'CASHU_TOKEN' }) | undefined {
    const quotes = this.queryClient.getQueryData<CashuReceiveQuote[]>([
      PendingCashuReceiveQuotesCache.Key,
    ]);
    return quotes?.find(
      (q): q is CashuReceiveQuote & { type: 'CASHU_TOKEN' } =>
        q.type === 'CASHU_TOKEN' &&
        q.tokenReceiveData.meltQuoteId === meltQuoteId,
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [PendingCashuReceiveQuotesCache.Key],
    });
  }
}

export function usePendingCashuReceiveQuotesCache() {
  const queryClient = useQueryClient();
  return useMemo(
    () => new PendingCashuReceiveQuotesCache(queryClient),
    [queryClient],
  );
}

export function useCreateCashuReceiveQuote() {
  const userId = useUser((user) => user.id);
  const cashuReceiveQuoteService = useCashuReceiveQuoteService();
  const cashuReceiveQuoteCache = useCashuReceiveQuoteCache();

  return useMutation({
    scope: {
      id: 'create-cashu-receive-quote',
    },
    mutationFn: async ({ account, amount, description }: CreateProps) => {
      const lightningQuote = await cashuReceiveQuoteService.getLightningQuote({
        wallet: account.wallet,
        amount,
        description,
      });

      return cashuReceiveQuoteService.createReceiveQuote({
        userId,
        account,
        receiveType: 'LIGHTNING',
        lightningQuote,
      });
    },
    onSuccess: (data) => {
      cashuReceiveQuoteCache.add(data);
    },
    retry: 1,
  });
}

function useCashuReceiveQuoteCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new CashuReceiveQuoteCache(queryClient), [queryClient]);
}

type UseCashuReceiveQuoteProps = {
  quoteId?: string;
  onPaid?: (quote: CashuReceiveQuote) => void;
  onExpired?: (quote: CashuReceiveQuote) => void;
};

type UseCashuReceiveQuoteResponse =
  | {
      status: 'LOADING';
      quote?: undefined;
    }
  | {
      status: CashuReceiveQuote['state'];
      quote: CashuReceiveQuote;
    };

export function useCashuReceiveQuote({
  quoteId,
  onPaid,
  onExpired,
}: UseCashuReceiveQuoteProps): UseCashuReceiveQuoteResponse {
  const enabled = !!quoteId;
  const onPaidRef = useLatest(onPaid);
  const onExpiredRef = useLatest(onExpired);
  const cache = useCashuReceiveQuoteCache();

  const { data } = useQuery({
    queryKey: [CashuReceiveQuoteCache.Key, quoteId],
    queryFn: () => cache.get(quoteId ?? ''),
    staleTime: Number.POSITIVE_INFINITY,
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

/**
 * Hook that returns a cashu receive quote change handler.
 */
export function useCashuReceiveQuoteChangeHandlers() {
  const pendingQuotesCache = usePendingCashuReceiveQuotesCache();
  const cashuReceiveQuoteCache = useCashuReceiveQuoteCache();
  const cashuReceiveQuoteRepository = useCashuReceiveQuoteRepository();

  return [
    {
      event: 'CASHU_RECEIVE_QUOTE_CREATED',
      handleEvent: async (payload: AgicashDbCashuReceiveQuote) => {
        const addedQuote = await cashuReceiveQuoteRepository.toQuote(payload);
        pendingQuotesCache.add(addedQuote);
      },
    },
    {
      event: 'CASHU_RECEIVE_QUOTE_UPDATED',
      handleEvent: async (payload: AgicashDbCashuReceiveQuote) => {
        const quote = await cashuReceiveQuoteRepository.toQuote(payload);

        cashuReceiveQuoteCache.updateIfExists(quote);

        const isQuoteStillPending = ['UNPAID', 'PAID'].includes(quote.state);
        if (isQuoteStillPending) {
          pendingQuotesCache.update(quote);
        } else {
          pendingQuotesCache.remove(quote);
        }
      },
    },
  ];
}

const usePendingCashuReceiveQuotes = () => {
  const cashuReceiveQuoteRepository = useCashuReceiveQuoteRepository();
  const userId = useUser((user) => user.id);
  const selectReceiveQuotesWithOnlineAccount =
    useSelectItemsWithOnlineAccount();

  const { data } = useQuery({
    queryKey: [PendingCashuReceiveQuotesCache.Key],
    queryFn: () => cashuReceiveQuoteRepository.getPending(userId),
    staleTime: Number.POSITIVE_INFINITY,
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
  const nut17Info = account.wallet.mintInfo.isSupported(17);
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
  onFetched: (mintQuoteResponse: MintQuoteResponse) => void;
};

const checkMintQuote = async (
  account: CashuAccount,
  quote: CashuReceiveQuote,
): Promise<MintQuoteResponse> => {
  const cashuUnit = getCashuUnit(quote.amount.currency);
  const wallet = account.wallet;

  const partialMintQuoteResponse = await wallet.checkMintQuote(quote.quoteId);

  return {
    ...partialMintQuoteResponse,
    // Amount and unit were added to the response later and some mints might still not be setting them atm so temporily we set them from the values we stored in the cashu receive quote.
    // See https://github.com/cashubtc/nuts/commit/e7112cd4ebfe14f0aaffa48cbdb5bd60fc450c51 and https://github.com/cashubtc/cashu-ts/pull/275/files#diff-820f0c31c07f61cf1b853d8a028670f0530af7965d60ec1853b048b626ae46ad
    // for more details. This can be removed once all the mints are updated and cashu-ts is updated.
    amount: partialMintQuoteResponse.amount ?? quote.amount.toNumber(cashuUnit),
    unit: wallet.unit,
  };
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
          const mintQuoteResponse = await checkMintQuote(account, quote);

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
  onUpdate: (mintQuoteResponse: MintQuoteResponse) => void;
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
  const queryClient = useQueryClient();

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
      queryClient.fetchQuery({
        queryKey: ['check-mint-quote', receiveQuote.quoteId],
        queryFn: () => {
          const account = getCashuAccount(receiveQuote.accountId);
          return checkMintQuote(account, receiveQuote);
        },
        retry: 5,
        staleTime: 0,
        gcTime: 0,
      }),
    [queryClient, getCashuAccount],
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
    async (mintQuote: MintQuoteResponse) => {
      console.debug(`Mint quote state changed: ${mintQuote.state}`, {
        paymentRequest: mintQuote.request,
        unit: mintQuote.unit,
      });

      const relatedReceiveQuote = pendingQuotesCache.getByMintQuoteId(
        mintQuote.quote,
      );

      if (!relatedReceiveQuote) {
        console.warn('No related receive quote found for the mint quote');
        return;
      }

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
  const cashuReceiveQuoteService = useCashuReceiveQuoteService();
  const pendingCashuReceiveQuotes = usePendingCashuReceiveQuotes();
  const pendingMeltQuotes = usePendingMeltQuotes(pendingCashuReceiveQuotes);
  const getCashuAccount = useGetCashuAccount();
  const pendingQuotesCache = usePendingCashuReceiveQuotesCache();

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
      const sourceWallet = getCashuWallet(
        quote.tokenReceiveData.sourceMintUrl,
        {
          unit: cashuUnit,
        },
      );

      await sourceWallet.meltProofsIdempotent(
        {
          quote: quote.tokenReceiveData.meltQuoteId,
          amount: quote.amount.toNumber(cashuUnit),
        },
        quote.tokenReceiveData.tokenProofs,
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
