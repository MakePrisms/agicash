import {
  type MeltQuoteBolt11Response,
  MintOperationError,
} from '@cashu/cashu-ts';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type Big from 'big.js';
import { useMemo, useState } from 'react';
import { sumProofs, useOnMeltQuoteStateChange } from '~/lib/cashu';
import { MeltQuoteSubscriptionManager } from '~/lib/cashu';
import type { Money } from '@agicash/sdk/lib/money/index';
import type { CashuAccount } from '@agicash/sdk/features/accounts/account';
import {
  useAccountsCache,
  useGetCashuAccount,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import type {
  AgicashDbCashuProof,
  AgicashDbCashuSendQuote,
} from '@agicash/sdk/db/database';
import { ConcurrencyError, DomainError } from '@agicash/sdk/features/shared/error';
import { useUser } from '../user/user-hooks';
import type { CashuSendQuote, DestinationDetails } from '@agicash/sdk/features/send/cashu-send-quote';
import { useCashuSendQuoteRepository } from './cashu-send-quote-repository';
import {
  type SendQuoteRequest,
  useCashuSendQuoteService,
} from './cashu-send-quote-service';

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
    retry: (failureCount, error) => {
      if (error instanceof DomainError) {
        return false;
      }
      return failureCount < 1;
    },
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
  const cashuSendQuoteRepository = useCashuSendQuoteRepository();

  return [
    {
      event: 'CASHU_SEND_QUOTE_CREATED',
      handleEvent: async (
        payload: AgicashDbCashuSendQuote & {
          cashu_proofs: AgicashDbCashuProof[];
        },
      ) => {
        const quote = await cashuSendQuoteRepository.toQuote(payload);
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
        const quote = await cashuSendQuoteRepository.toQuote(payload);

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
      meltQuote: MeltQuoteBolt11Response;
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
      meltQuote: MeltQuoteBolt11Response;
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
