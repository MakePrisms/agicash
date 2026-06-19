import type { CashuLightningQuote } from '@agicash/wallet-sdk';
import type { Money } from '@agicash/money';
import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type Big from 'big.js';
import { useEffect, useMemo } from 'react';
import { getSdk } from '~/lib/sdk';
import type { CashuAccount } from '../accounts/account';
import { useGetCashuAccount } from '../accounts/account-hooks';
import { ConcurrencyError, DomainError } from '../shared/error';
import type { CashuSendQuote, DestinationDetails } from './cashu-send-quote';

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
      getSdk().cashu.send.createLightningQuote({
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
      sendQuote: CashuLightningQuote;
      destinationDetails?: DestinationDetails;
    }) => {
      const account = getCashuAccount(accountId);
      // Create-only: the SDK leader performs the melt asynchronously.
      return getSdk().cashu.send.execute({
        account,
        quote: sendQuote,
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

export function useWireCashuSendQuoteEvents() {
  const unresolvedSendQuotesCache = useUnresolvedCashuSendQuotesCache();

  useEffect(() => {
    const sdk = getSdk();
    const unsubscribers = [
      sdk.on('cashu-send-quote:created', ({ entity }) => {
        unresolvedSendQuotesCache.add(entity);
      }),
      sdk.on('cashu-send-quote:updated', ({ entity }) => {
        if (['UNPAID', 'PENDING'].includes(entity.state)) {
          unresolvedSendQuotesCache.update(entity);
        } else {
          unresolvedSendQuotesCache.remove(entity);
        }
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [unresolvedSendQuotesCache]);
}
