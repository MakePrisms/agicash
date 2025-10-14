import { type MeltQuoteResponse, MintOperationError } from '@cashu/cashu-ts';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import type Big from 'big.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { sumProofs } from '~/lib/cashu';
import type { Money } from '~/lib/money';
import {
  type LongTimeout,
  clearLongTimeout,
  setLongTimeout,
} from '~/lib/timeout';
import { useLatest } from '~/lib/use-latest';
import type { CashuAccount } from '../accounts/account';
import {
  useAccount,
  useAccountsCache,
  useGetLatestCashuAccount,
} from '../accounts/account-hooks';
import type { AgicashDbCashuSendQuote } from '../agicash-db/database';
import { useEncryption } from '../shared/encryption';
import { DomainError, NotFoundError } from '../shared/error';
import type { DestinationDetails } from '../transactions/transaction';
import { useUser } from '../user/user-hooks';
import type { CashuSendQuote } from './cashu-send-quote';
import {
  CashuSendQuoteRepository,
  useCashuSendQuoteRepository,
} from './cashu-send-quote-repository';
import {
  type SendQuoteRequest,
  useCashuSendQuoteService,
} from './cashu-send-quote-service';
import { MeltQuoteSubscriptionManager } from './melt-quote-subscription-manager';

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
      (curr) => (curr ? quote : undefined),
    );
  }
}

class UnresolvedCashuSendQuotesCache {
  // Query that tracks all unresolved cashu send quotes (active and background ones).
  public static Key = 'unresolved-cashu-send-quotes';

  constructor(private readonly queryClient: QueryClient) {}

  add(quote: CashuSendQuote) {
    this.queryClient.setQueryData<CashuSendQuote[]>(
      [UnresolvedCashuSendQuotesCache.Key],
      (curr) => [...(curr ?? []), quote],
    );
  }

  update(quote: CashuSendQuote) {
    this.queryClient.setQueryData<CashuSendQuote[]>(
      [UnresolvedCashuSendQuotesCache.Key],
      (curr) => curr?.map((q) => (q.id === quote.id ? quote : q)),
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

export function useCreateCashuSendQuote() {
  const cashuSendQuoteService = useCashuSendQuoteService();

  return useMutation({
    mutationKey: ['create-cashu-send-quote'],
    scope: {
      id: 'create-cashu-send-quote',
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
  onError,
}: { onError: (error: Error) => void }) {
  const userId = useUser((user) => user.id);
  const cashuSendQuoteService = useCashuSendQuoteService();
  const getCashuAccount = useGetLatestCashuAccount();

  return useMutation({
    mutationKey: ['initiate-cashu-send-quote'],
    scope: {
      id: 'initiate-cashu-send-quote',
    },
    mutationFn: async ({
      accountId,
      sendQuote,
      destinationDetails,
    }: {
      accountId: string;
      sendQuote: SendQuoteRequest;
      destinationDetails?: DestinationDetails;
    }) => {
      const account = await getCashuAccount(accountId);
      return cashuSendQuoteService.createSendQuote({
        userId,
        account,
        sendQuote,
        destinationDetails,
      });
    },
    onError: onError,
    retry: (failureCount, error) => {
      if (error instanceof DomainError) {
        return false;
      }
      return failureCount < 1;
    },
  });
}

type UseTrackCashuSendQuoteProps = {
  sendQuoteId?: string;
  onPending?: (send: CashuSendQuote) => void;
  onPaid?: (send: CashuSendQuote) => void;
  onExpired?: (send: CashuSendQuote) => void;
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
}: UseTrackCashuSendQuoteProps): UseTrackCashuSendQuoteResponse {
  const enabled = !!sendQuoteId;
  const onPendingRef = useLatest(onPending);
  const onPaidRef = useLatest(onPaid);
  const onExpiredRef = useLatest(onExpired);
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

  const { data } = useQuery({
    queryKey: [UnresolvedCashuSendQuotesCache.Key],
    queryFn: () => cashuSendQuoteRepository.getUnresolved(userId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    throwOnError: true,
  });

  return data ?? [];
}

type OnMeltQuoteStateChangeProps = {
  sendQuotes: CashuSendQuote[];
  onUnpaid: (
    account: CashuAccount,
    quote: CashuSendQuote,
    meltQuote: MeltQuoteResponse,
  ) => void;
  onPending: (
    account: CashuAccount,
    quote: CashuSendQuote,
    meltQuote: MeltQuoteResponse,
  ) => void;
  onPaid: (
    account: CashuAccount,
    send: CashuSendQuote,
    meltQuote: MeltQuoteResponse,
  ) => void;
  onExpired: (
    account: CashuAccount,
    quote: CashuSendQuote,
    meltQuote: MeltQuoteResponse,
  ) => void;
};

const checkMeltQuote = async (
  account: CashuAccount,
  quote: CashuSendQuote,
): Promise<MeltQuoteResponse> => {
  const wallet = account.wallet;

  const partialMeltQuoteResponse = await wallet.checkMeltQuote(quote.quoteId);

  return {
    ...partialMeltQuoteResponse,
    // Amount and unit were added to the response later and some mints might still not be setting them atm so temporily we set them from the values we stored in the cashu receive quote.
    // See https://github.com/cashubtc/nuts/commit/e7112cd4ebfe14f0aaffa48cbdb5bd60fc450c51 and https://github.com/cashubtc/cashu-ts/pull/275/files#diff-820f0c31c07f61cf1b853d8a028670f0530af7965d60ec1853b048b626ae46ad
    // for more details.
    request: partialMeltQuoteResponse.request ?? quote.paymentRequest,
    unit: wallet.unit,
  };
};

function useOnMeltQuoteStateChange({
  sendQuotes,
  onUnpaid,
  onPending,
  onPaid,
  onExpired,
}: OnMeltQuoteStateChangeProps) {
  const accountsCache = useAccountsCache();
  const onUnpaidRef = useLatest(onUnpaid);
  const onPendingRef = useLatest(onPending);
  const onPaidRef = useLatest(onPaid);
  const onExpiredRef = useLatest(onExpired);
  const [subscriptionManager] = useState(
    () => new MeltQuoteSubscriptionManager(),
  );
  const queryClient = useQueryClient();
  const getCashuAccount = useGetLatestCashuAccount();

  const handleMeltQuoteUpdate = useCallback(
    async (meltQuote: MeltQuoteResponse) => {
      // TODO: remove (or mask) the sensitive data from this log (or see if we can configure sentry not to send sensitive data to server) or completely remove it.
      console.debug('Melt quote updated', meltQuote);

      const relatedSendQuote = sendQuotes.find(
        (sendQuote) => sendQuote.quoteId === meltQuote.quote,
      );

      if (!relatedSendQuote) {
        console.warn('No related send quote found for the melt quote');
        return;
      }

      const account = await getCashuAccount(relatedSendQuote.accountId);

      const expiresAt = new Date(relatedSendQuote.expiresAt);
      const now = new Date();

      if (
        meltQuote.state === 'UNPAID' &&
        expiresAt < now &&
        relatedSendQuote.state !== 'EXPIRED'
      ) {
        onExpiredRef.current(account, relatedSendQuote, meltQuote);
      } else if (
        meltQuote.state === 'PAID' &&
        relatedSendQuote.state !== 'PAID'
      ) {
        // There is a bug in nutshell where the change is not included in the melt quote state updates, so we need to refetch the quote to get the change proofs.
        // see https://github.com/cashubtc/nutshell/pull/773
        // The same bug in CDK too: https://github.com/cashubtc/cdk/pull/889
        const inputAmount = sumProofs(relatedSendQuote.proofs);
        const expectChange = inputAmount > meltQuote.amount;
        if (
          expectChange &&
          !(meltQuote.change && meltQuote.change.length > 0)
        ) {
          const latestMeltQuote = await getMeltQuote(relatedSendQuote);
          onPaidRef.current(account, relatedSendQuote, latestMeltQuote);
        } else {
          onPaidRef.current(account, relatedSendQuote, meltQuote);
        }
      } else if (
        meltQuote.state === 'PENDING' &&
        relatedSendQuote.state !== 'PENDING'
      ) {
        onPendingRef.current(account, relatedSendQuote, meltQuote);
      } else if (
        meltQuote.state === 'UNPAID' &&
        relatedSendQuote.state === 'UNPAID'
      ) {
        onUnpaidRef.current(account, relatedSendQuote, meltQuote);
      }
    },
    [sendQuotes, getCashuAccount],
  );

  const { mutate: subscribe } = useMutation({
    mutationFn: (props: Parameters<typeof subscriptionManager.subscribe>[0]) =>
      subscriptionManager.subscribe(props),
    retry: 5,
    onError: (error, variables) => {
      console.error('Error subscribing to melt quote updates', {
        mintUrl: variables.mintUrl,
        cause: error,
      });
    },
  });

  useEffect(() => {
    if (sendQuotes.length === 0) return;

    const quotesByMint = sendQuotes.reduce<Record<string, CashuSendQuote[]>>(
      (acc, quote) => {
        const account = accountsCache.get(quote.accountId);
        if (!account || account.type !== 'cashu') {
          throw new Error(`Cashu account not found for id: ${quote.accountId}`);
        }
        const existingQuotesForMint = acc[account.mintUrl] ?? [];
        acc[account.mintUrl] = existingQuotesForMint.concat(quote);
        return acc;
      },
      {},
    );

    Object.entries(quotesByMint).map(([mintUrl, quotes]) =>
      subscribe({ mintUrl, quotes, onUpdate: handleMeltQuoteUpdate }),
    );
  }, [sendQuotes, handleMeltQuoteUpdate, accountsCache, subscribe]);

  const getMeltQuote = useCallback(
    (sendQuote: CashuSendQuote) =>
      queryClient.fetchQuery({
        queryKey: ['check-melt-quote', sendQuote.quoteId],
        queryFn: async () => {
          const account = await getCashuAccount(sendQuote.accountId);
          return checkMeltQuote(account, sendQuote);
        },
        retry: 5,
        staleTime: 0,
        gcTime: 0,
      }),
    [queryClient, getCashuAccount],
  );

  useEffect(() => {
    // We need to check the state of the quote upon expiration because there is no state change for the expiration
    // so socket will not notify us.
    if (sendQuotes.length === 0) return;

    const timeouts: LongTimeout[] = [];

    for (const sendQuote of sendQuotes) {
      const msUntilExpiration =
        new Date(sendQuote.expiresAt).getTime() - Date.now();
      const quoteTimeout = setLongTimeout(async () => {
        try {
          const meltQuote = await getMeltQuote(sendQuote);
          return handleMeltQuoteUpdate(meltQuote);
        } catch (error) {
          console.error('Error checking melt quote upon expiration', {
            cause: error,
          });
        }
      }, msUntilExpiration);
      timeouts.push(quoteTimeout);
    }

    return () => {
      timeouts.forEach((timeout) => clearLongTimeout(timeout));
    };
  }, [sendQuotes, handleMeltQuoteUpdate, getMeltQuote]);
}

/**
 * Hook that returns a cashu send quote change handler.
 */
export function useCashuSendQuoteChangeHandler() {
  const encryption = useEncryption();
  const unresolvedSendQuotesCache = useUnresolvedCashuSendQuotesCache();
  const cashuSendQuoteCache = useCashuSendQuoteCache();

  return {
    table: 'cashu_send_quotes',
    onInsert: async (payload: AgicashDbCashuSendQuote) => {
      const quote = await CashuSendQuoteRepository.toSend(
        payload,
        encryption.decrypt,
      );
      unresolvedSendQuotesCache.add(quote);
    },
    onUpdate: async (payload: AgicashDbCashuSendQuote) => {
      const quote = await CashuSendQuoteRepository.toSend(
        payload,
        encryption.decrypt,
      );

      cashuSendQuoteCache.updateIfExists(quote);

      if (['UNPAID', 'PENDING'].includes(quote.state)) {
        unresolvedSendQuotesCache.update(quote);
      } else {
        unresolvedSendQuotesCache.remove(quote);
      }
    },
  };
}

export function useProcessCashuSendQuoteTasks() {
  const cashuSendService = useCashuSendQuoteService();
  const unresolvedSendQuotes = useUnresolvedCashuSendQuotes();
  const getCashuAccount = useGetLatestCashuAccount();

  const { mutate: failSendQuote } = useMutation({
    mutationFn: async ({
      sendQuoteId,
      reason,
    }: {
      sendQuoteId: string;
      reason: string;
    }) => {
      const sendQuote = unresolvedSendQuotes.find(
        (quote) => quote.id === sendQuoteId,
      );
      if (!sendQuote) {
        // This means that the quote is not pending anymore so it was removed from the cache.
        // This can happen if the quote was completed, failed or expired in the meantime.
        return;
      }

      const account = await getCashuAccount(sendQuote.accountId);
      await cashuSendService.failSendQuote(account, sendQuote, reason);
    },
    retry: 3,
    throwOnError: true,
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
      meltQuote: MeltQuoteResponse;
    }) => {
      const sendQuote = unresolvedSendQuotes.find(
        (quote) => quote.id === sendQuoteId,
      );
      if (!sendQuote) {
        // This means that the quote is not pending anymore so it was removed from the cache.
        // This can happen if the quote was completed, failed or expired in the meantime.
        return;
      }

      const account = await getCashuAccount(sendQuote.accountId);

      await cashuSendService
        .initiateSend(account, sendQuote, meltQuote)
        .catch((error) => {
          if (error instanceof MintOperationError) {
            failSendQuote({
              sendQuoteId: sendQuoteId,
              reason: error.message,
            });
          }
        });
    },
    retry: 3,
    throwOnError: true,
    onError: (error, variables) => {
      console.error('Error while initiating send', {
        cause: error,
        sendQuoteId: variables.sendQuoteId,
      });
    },
  });

  const { mutate: markSendQuoteAsPending } = useMutation({
    mutationFn: async (sendQuoteId: string) => {
      const sendQuote = unresolvedSendQuotes.find(
        (quote) => quote.id === sendQuoteId,
      );
      if (!sendQuote) {
        // This means that the quote is not pending anymore so it was removed from the cache.
        // This can happen if the quote was completed, failed or expired in the meantime.
        return;
      }

      await cashuSendService.markSendQuoteAsPending(sendQuote);
    },
    retry: 3,
    throwOnError: true,
    onError: (error, sendQuoteId) => {
      console.error('Mark send quote as pending error', {
        cause: error,
        sendQuoteId,
      });
    },
  });

  const { mutate: expireSendQuote } = useMutation({
    mutationFn: async (sendQuoteId: string) => {
      const sendQuote = unresolvedSendQuotes.find(
        (quote) => quote.id === sendQuoteId,
      );
      if (!sendQuote) {
        // This means that the quote is not pending anymore so it was removed from the cache.
        // This can happen if the quote was completed, failed or expired in the meantime.
        return;
      }

      const account = await getCashuAccount(sendQuote.accountId);

      return cashuSendService.expireSendQuote(account, sendQuote);
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
      meltQuote: MeltQuoteResponse;
    }) => {
      const sendQuote = unresolvedSendQuotes.find(
        (quote) => quote.id === sendQuoteId,
      );
      if (!sendQuote) {
        // This means that the quote is not pending anymore so it was removed from the cache.
        // This can happen if the quote was completed, failed or expired in the meantime.
        return;
      }

      const account = await getCashuAccount(sendQuote.accountId);

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
    sendQuotes: unresolvedSendQuotes,
    onUnpaid: (_, send, meltQuote) => {
      // In case of failed payment the mint will flip the state of the melt quote back to UNPAID.
      // In that case we don't want to initiate the send again so we are only initiating the send if our quote state is also UNPAID which won't be the case if the send was already initiated.
      if (send.state === 'UNPAID') {
        initiateSend({
          sendQuoteId: send.id,
          meltQuote,
        });
      }
    },
    onPending: (_, send) => {
      markSendQuoteAsPending(send.id);
    },
    onExpired: (_, send) => {
      expireSendQuote(send.id);
    },
    onPaid: (_, send, meltQuote) => {
      completeSendQuote({
        sendQuoteId: send.id,
        meltQuote,
      });
    },
  });
}
