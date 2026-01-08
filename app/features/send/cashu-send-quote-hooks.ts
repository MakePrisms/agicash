import {
  MintOperationError,
  type PartialMeltQuoteResponse,
} from '@cashu/cashu-ts';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import type Big from 'big.js';
import { useEffect, useMemo, useState } from 'react';
import { sumProofs, useOnMeltQuoteStateChange } from '~/lib/cashu';
import { MeltQuoteSubscriptionManager } from '~/lib/cashu';
import type { Money } from '~/lib/money';
import { useLatest } from '~/lib/use-latest';
import type { CashuAccount } from '../accounts/account';
import {
  useAccount,
  useAccountsCache,
  useGetCashuAccount,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import type {
  AgicashDbCashuProof,
  AgicashDbCashuSendQuote,
} from '../agicash-db/database';
import { ConcurrencyError, DomainError, NotFoundError } from '../shared/error';
import type { DestinationDetails } from '../transactions/transaction';
import { useUser } from '../user/user-hooks';
import type { CashuSendQuote } from './cashu-send-quote';
import { useCashuSendQuoteRepository } from './cashu-send-quote-repository';
import {
  type SendQuoteRequest,
  useCashuSendQuoteService,
} from './cashu-send-quote-service';

class CashuSendQuoteCache {
  // Query that tracks the "active" cashu send quote. Active one is the one that user created in current browser session.
  // We want to track active send quote even after it is completed or expired which is why we can't use unresolved send quotes query.
  // Unresolved send quotes query is used for active unresolved quotes plus "background" unresolved quotes. "Background" quotes are send quotes
  // that were created in previous browser sessions.
  public static Key = 'cashu-send-quote';

  constructor(private readonly queryClient: QueryClient) {}

  get(quoteId: string) {
    return this.queryClient.getQueryData<CashuSendQuote>([
      CashuSendQuoteCache.Key,
      quoteId,
    ]);
  }

  add(quote: CashuSendQuote) {
    this.queryClient.setQueryData<CashuSendQuote>(
      [CashuSendQuoteCache.Key, quote.id],
      quote,
    );
  }

  updateIfExists(quote: CashuSendQuote) {
    this.queryClient.setQueryData<CashuSendQuote>(
      [CashuSendQuoteCache.Key, quote.id],
      (curr) => (curr && curr.version < quote.version ? quote : undefined),
    );
  }
}

class UnresolvedCashuSendQuotesCache {
  // Query that tracks all unresolved cashu send quotes (active and background ones).
  public static Key = 'unresolved-cashu-send-quotes';

  constructor(private readonly queryClient: QueryClient) {}

  get(sendQuoteId: string) {
    return this.queryClient
      .getQueryData<CashuSendQuote[]>([UnresolvedCashuSendQuotesCache.Key])
      ?.find((q) => q.id === sendQuoteId);
  }

  getByMeltQuoteId(meltQuoteId: string) {
    const quotes = this.queryClient.getQueryData<CashuSendQuote[]>([
      UnresolvedCashuSendQuotesCache.Key,
    ]);
    return quotes?.find((q) => q.quoteId === meltQuoteId);
  }

  add(quote: CashuSendQuote) {
    this.queryClient.setQueryData<CashuSendQuote[]>(
      [UnresolvedCashuSendQuotesCache.Key],
      (curr) => [...(curr ?? []), quote],
    );
  }

  update(quote: CashuSendQuote) {
    this.queryClient.setQueryData<CashuSendQuote[]>(
      [UnresolvedCashuSendQuotesCache.Key],
      (curr) =>
        curr?.map((q) =>
          q.id === quote.id && q.version < quote.version ? quote : q,
        ),
    );
  }

  remove(quote: CashuSendQuote) {
    this.queryClient.setQueryData<CashuSendQuote[]>(
      [UnresolvedCashuSendQuotesCache.Key],
      (curr) => curr?.filter((q) => q.id !== quote.id),
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [UnresolvedCashuSendQuotesCache.Key],
    });
  }
}

export function useUnresolvedCashuSendQuotesCache() {
  const queryClient = useQueryClient();
  return useMemo(
    () => new UnresolvedCashuSendQuotesCache(queryClient),
    [queryClient],
  );
}

function useCashuSendQuoteCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new CashuSendQuoteCache(queryClient), [queryClient]);
}

export function useCreateCashuLightningSendQuote() {
  const cashuSendQuoteService = useCashuSendQuoteService();

  return useMutation({
    scope: {
      id: 'create-cashu-lightning-send-quote',
    },
    mutationFn: ({
      account,
      amount,
      paymentRequest,
      exchangeRate,
    }: {
      account: CashuAccount;
      paymentRequest: string;
      amount?: Money;
      exchangeRate?: Big;
    }) =>
      cashuSendQuoteService.getLightningQuote({
        account,
        amount,
        paymentRequest,
        exchangeRate,
      }),
    retry: 1,
  });
}

export function useInitiateCashuSendQuote({
  onSuccess,
  onError,
}: {
  onSuccess: (data: CashuSendQuote) => void;
  onError: (error: Error) => void;
}) {
  const userId = useUser((user) => user.id);
  const cashuSendQuoteService = useCashuSendQuoteService();
  const cashuSendQuoteCache = useCashuSendQuoteCache();
  const getCashuAccount = useGetCashuAccount();

  return useMutation({
    mutationKey: ['initiate-cashu-send-quote'],
    scope: {
      id: 'initiate-cashu-send-quote',
    },
    mutationFn: ({
      accountId,
      sendQuote,
      destinationDetails,
    }: {
      accountId: string;
      sendQuote: SendQuoteRequest;
      destinationDetails?: DestinationDetails;
    }) => {
      const account = getCashuAccount(accountId);
      return cashuSendQuoteService.createSendQuote({
        userId,
        account,
        sendQuote,
        destinationDetails,
      });
    },
    onSuccess: (data) => {
      cashuSendQuoteCache.add(data);
      onSuccess(data);
    },
    onError: onError,
    retry: (failureCount, error) => {
      if (error instanceof ConcurrencyError) {
        return true;
      }
      if (error instanceof DomainError) {
        return false;
      }
      return failureCount < 1;
    },
  });
}

type UseTrackCashuSendQuoteProps = {
  sendQuoteId?: string;
  onPending?: (send: CashuSendQuote & { state: 'PENDING' }) => void;
  onPaid?: (send: CashuSendQuote & { state: 'PAID' }) => void;
  onExpired?: (send: CashuSendQuote & { state: 'EXPIRED' }) => void;
  onFailed?: (send: CashuSendQuote & { state: 'FAILED' }) => void;
};

type UseTrackCashuSendQuoteResponse =
  | {
      status: 'DISABLED' | 'LOADING';
      quote?: undefined;
    }
  | {
      status: CashuSendQuote['state'];
      quote: CashuSendQuote;
    };

export function useTrackCashuSendQuote({
  sendQuoteId = '',
  onPending,
  onPaid,
  onExpired,
  onFailed,
}: UseTrackCashuSendQuoteProps): UseTrackCashuSendQuoteResponse {
  const enabled = !!sendQuoteId;
  const onPendingRef = useLatest(onPending);
  const onPaidRef = useLatest(onPaid);
  const onExpiredRef = useLatest(onExpired);
  const onFailedRef = useLatest(onFailed);
  const cache = useCashuSendQuoteCache();

  const { data } = useQuery({
    queryKey: [CashuSendQuoteCache.Key, sendQuoteId],
    queryFn: () => cache.get(sendQuoteId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    enabled,
  });

  useEffect(() => {
    if (!data) return;

    if (data.state === 'PENDING') {
      onPendingRef.current?.(data);
    } else if (data.state === 'PAID') {
      onPaidRef.current?.(data);
    } else if (data.state === 'EXPIRED') {
      onExpiredRef.current?.(data);
    } else if (data.state === 'FAILED') {
      onFailedRef.current?.(data);
    }
  }, [data]);

  if (!enabled) {
    return { status: 'DISABLED' };
  }

  if (!data) {
    return { status: 'LOADING' };
  }

  return {
    status: data.state,
    quote: data,
  };
}

export function useCashuSendQuote(sendQuoteId: string) {
  const cashuSendQuoteRepository = useCashuSendQuoteRepository();

  const result = useSuspenseQuery({
    queryKey: [CashuSendQuoteCache.Key, sendQuoteId],
    queryFn: async () => {
      const quote = await cashuSendQuoteRepository.get(sendQuoteId);
      if (!quote) {
        throw new NotFoundError(
          `Cashu send quote not found for id: ${sendQuoteId}`,
        );
      }
      return quote;
    },
    retry: (failureCount, error) => {
      if (error instanceof NotFoundError) {
        return false;
      }
      return failureCount <= 3;
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });

  const account = useAccount<'cashu'>(result.data.accountId);

  return {
    ...result,
    data: {
      ...result.data,
      account,
    },
  };
}

function useUnresolvedCashuSendQuotes() {
  const cashuSendQuoteRepository = useCashuSendQuoteRepository();
  const userId = useUser((user) => user.id);
  const selectSendQuotesWithOnlineAccount = useSelectItemsWithOnlineAccount();

  const { data } = useQuery({
    queryKey: [UnresolvedCashuSendQuotesCache.Key],
    queryFn: () => cashuSendQuoteRepository.getUnresolved(userId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    throwOnError: true,
    select: selectSendQuotesWithOnlineAccount,
  });

  return data ?? [];
}

function usePendingMeltQuotes() {
  const unresolvedCashuSendQuotes = useUnresolvedCashuSendQuotes();
  const accountsCache = useAccountsCache();

  return useMemo(() => {
    return unresolvedCashuSendQuotes.map((q) => {
      const account = accountsCache.get(q.accountId);
      if (!account || account.type !== 'cashu') {
        throw new Error(`Cashu account not found for send quote: ${q.id}`);
      }
      return {
        id: q.quoteId,
        mintUrl: account.mintUrl,
        expiryInMs: new Date(q.expiresAt).getTime(),
        inputAmount: sumProofs(q.proofs),
      };
    });
  }, [unresolvedCashuSendQuotes, accountsCache]);
}
/**
 * Hook that returns a cashu send quote change handler.
 */
export function useCashuSendQuoteChangeHandlers() {
  const unresolvedSendQuotesCache = useUnresolvedCashuSendQuotesCache();
  const cashuSendQuoteCache = useCashuSendQuoteCache();
  const cashuSendQuoteRepository = useCashuSendQuoteRepository();

  return [
    {
      event: 'CASHU_SEND_QUOTE_CREATED',
      handleEvent: async (
        payload: AgicashDbCashuSendQuote & {
          cashu_proofs: AgicashDbCashuProof[];
        },
      ) => {
        const quote = await cashuSendQuoteRepository.toSendQuote(payload);
        unresolvedSendQuotesCache.add(quote);
      },
    },
    {
      event: 'CASHU_SEND_QUOTE_UPDATED',
      handleEvent: async (
        payload: AgicashDbCashuSendQuote & {
          cashu_proofs: AgicashDbCashuProof[];
        },
      ) => {
        const quote = await cashuSendQuoteRepository.toSendQuote(payload);

        cashuSendQuoteCache.updateIfExists(quote);

        if (['UNPAID', 'PENDING'].includes(quote.state)) {
          unresolvedSendQuotesCache.update(quote);
        } else {
          unresolvedSendQuotesCache.remove(quote);
        }
      },
    },
  ];
}

export function useProcessCashuSendQuoteTasks() {
  const cashuSendService = useCashuSendQuoteService();
  const pendingMeltQuotes = usePendingMeltQuotes();
  const getCashuAccount = useGetCashuAccount();
  const unresolvedSendQuotesCache = useUnresolvedCashuSendQuotesCache();
  const [subscriptionManager] = useState(
    () => new MeltQuoteSubscriptionManager(),
  );

  const { mutate: failSendQuote } = useMutation({
    mutationFn: async ({
      sendQuoteId,
      reason,
    }: {
      sendQuoteId: string;
      reason: string;
    }) => {
      const sendQuote = unresolvedSendQuotesCache.get(sendQuoteId);
      if (!sendQuote) {
        // This means that the quote is not pending anymore so it was removed from the cache.
        // This can happen if the quote was completed, failed or expired in the meantime.
        return;
      }

      const account = getCashuAccount(sendQuote.accountId);
      const failedQuote = await cashuSendService.failSendQuote(
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
        // subscribed to that melt quote so useOnMeltQuoteStateChange handler would not be called again for this new
        // send quote so new send quote would not be initiated until next full page reload.
        subscriptionManager.removeQuoteFromSubscription(data);
      }
    },
    onError: (error, variables) => {
      console.error('Failed to mark payment as failed', {
        cause: error,
        sendQuoteId: variables.sendQuoteId,
      });
    },
  });

  const { mutate: initiateSend } = useMutation({
    mutationFn: async ({
      sendQuoteId,
      meltQuote,
    }: {
      sendQuoteId: string;
      meltQuote: PartialMeltQuoteResponse;
    }) => {
      const sendQuote = unresolvedSendQuotesCache.get(sendQuoteId);
      if (!sendQuote) {
        // This means that the quote is not pending anymore so it was removed from the cache.
        // This can happen if the quote was completed, failed or expired in the meantime.
        return;
      }

      const account = getCashuAccount(sendQuote.accountId);

      await cashuSendService.initiateSend(account, sendQuote, meltQuote);
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
        failSendQuote({
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

  const { mutate: markSendQuoteAsPending } = useMutation({
    mutationFn: async (sendQuoteId: string) => {
      const sendQuote = unresolvedSendQuotesCache.get(sendQuoteId);
      if (!sendQuote) {
        // This means that the quote is not pending anymore so it was removed from the cache.
        // This can happen if the quote was completed, failed or expired in the meantime.
        return;
      }

      return cashuSendService.markSendQuoteAsPending(sendQuote);
    },
    retry: 3,
    throwOnError: true,
    onSuccess: (quote) => {
      if (quote) {
        unresolvedSendQuotesCache.update(quote);
      }
    },
    onError: (error, sendQuoteId) => {
      console.error('Mark send quote as pending error', {
        cause: error,
        sendQuoteId,
      });
    },
  });

  const { mutate: expireSendQuote } = useMutation({
    mutationFn: async (sendQuoteId: string) => {
      const sendQuote = unresolvedSendQuotesCache.get(sendQuoteId);
      if (!sendQuote) {
        // This means that the quote is not pending anymore so it was removed from the cache.
        // This can happen if the quote was completed, failed or expired in the meantime.
        return;
      }

      return cashuSendService.expireSendQuote(sendQuote);
    },
    retry: 3,
    throwOnError: true,
    onError: (error, sendQuoteId) => {
      console.error('Expire send quote error', {
        cause: error,
        sendQuoteId,
      });
    },
  });

  const { mutate: completeSendQuote } = useMutation({
    mutationFn: async ({
      sendQuoteId,
      meltQuote,
    }: {
      sendQuoteId: string;
      meltQuote: PartialMeltQuoteResponse;
    }) => {
      const sendQuote = unresolvedSendQuotesCache.get(sendQuoteId);
      if (!sendQuote) {
        // This means that the quote is not pending anymore so it was removed from the cache.
        // This can happen if the quote was completed, failed or expired in the meantime.
        return;
      }

      const account = getCashuAccount(sendQuote.accountId);

      return cashuSendService.completeSendQuote(account, sendQuote, meltQuote);
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

  useOnMeltQuoteStateChange({
    subscriptionManager,
    quotes: pendingMeltQuotes,
    onUnpaid: (meltQuote) => {
      const sendQuote = unresolvedSendQuotesCache.getByMeltQuoteId(
        meltQuote.quote,
      );
      if (!sendQuote) {
        return;
      }

      // In case of failed payment the mint will flip the state of the melt quote back to UNPAID.
      // In that case we don't want to initiate the send again so we are only initiating the send if our quote state is also UNPAID which won't be the case if the send was already initiated.
      if (sendQuote.state === 'UNPAID') {
        initiateSend(
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
      const sendQuote = unresolvedSendQuotesCache.getByMeltQuoteId(
        meltQuote.quote,
      );
      if (!sendQuote) {
        return;
      }

      markSendQuoteAsPending(sendQuote.id, {
        scope: { id: `cashu-send-quote-${sendQuote.id}` },
      });
    },
    onExpired: (meltQuote) => {
      const sendQuote = unresolvedSendQuotesCache.getByMeltQuoteId(
        meltQuote.quote,
      );
      if (!sendQuote) {
        return;
      }

      expireSendQuote(sendQuote.id, {
        scope: { id: `cashu-send-quote-${sendQuote.id}` },
      });
    },
    onPaid: (meltQuote) => {
      const sendQuote = unresolvedSendQuotesCache.getByMeltQuoteId(
        meltQuote.quote,
      );
      if (!sendQuote) {
        return;
      }

      completeSendQuote(
        {
          sendQuoteId: sendQuote.id,
          meltQuote,
        },
        { scope: { id: `cashu-send-quote-${sendQuote.id}` } },
      );
    },
  });
}
