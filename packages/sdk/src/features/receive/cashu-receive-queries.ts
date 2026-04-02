import type { FetchQueryOptions, QueryClient } from '@tanstack/query-core';
import {
  cashuReceiveQuoteQueryKey,
  pendingCashuReceiveQuotesQueryKey,
} from '../../core/query-keys';
import type { Account } from '../accounts/account';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import type { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';

export class CashuReceiveQuoteCache {
  constructor(private readonly queryClient: QueryClient) {}

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: cashuReceiveQuoteQueryKey(),
    });
  }

  add(quote: CashuReceiveQuote) {
    this.queryClient.setQueryData<CashuReceiveQuote>(
      cashuReceiveQuoteQueryKey(quote.id),
      quote,
    );
  }

  updateIfExists(quote: CashuReceiveQuote) {
    this.queryClient.setQueryData<CashuReceiveQuote>(
      cashuReceiveQuoteQueryKey(quote.id),
      (curr) => (curr && curr.version < quote.version ? quote : undefined),
    );
  }
}

export class PendingCashuReceiveQuotesCache {
  constructor(private readonly queryClient: QueryClient) {}

  get(quoteId: string) {
    return this.queryClient
      .getQueryData<CashuReceiveQuote[]>(pendingCashuReceiveQuotesQueryKey())
      ?.find((q) => q.id === quoteId);
  }

  add(quote: CashuReceiveQuote) {
    this.queryClient.setQueryData<CashuReceiveQuote[]>(
      pendingCashuReceiveQuotesQueryKey(),
      (curr = []) => [...curr, quote],
    );
  }

  update(quote: CashuReceiveQuote) {
    this.queryClient.setQueryData<CashuReceiveQuote[]>(
      pendingCashuReceiveQuotesQueryKey(),
      (curr) =>
        curr?.map((q) =>
          q.id === quote.id && q.version < quote.version ? quote : q,
        ),
    );
  }

  remove(quote: CashuReceiveQuote) {
    this.queryClient.setQueryData<CashuReceiveQuote[]>(
      pendingCashuReceiveQuotesQueryKey(),
      (curr) => curr?.filter((q) => q.id !== quote.id),
    );
  }

  getByMintQuoteId(mintQuoteId: string) {
    const quotes = this.queryClient.getQueryData<CashuReceiveQuote[]>(
      pendingCashuReceiveQuotesQueryKey(),
    );
    return quotes?.find((q) => q.quoteId === mintQuoteId);
  }

  getByMeltQuoteId(
    meltQuoteId: string,
  ): (CashuReceiveQuote & { type: 'CASHU_TOKEN' }) | undefined {
    const quotes = this.queryClient.getQueryData<CashuReceiveQuote[]>(
      pendingCashuReceiveQuotesQueryKey(),
    );
    return quotes?.find(
      (q): q is CashuReceiveQuote & { type: 'CASHU_TOKEN' } =>
        q.type === 'CASHU_TOKEN' &&
        q.tokenReceiveData.meltQuoteId === meltQuoteId,
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: pendingCashuReceiveQuotesQueryKey(),
    });
  }
}

export const cashuReceiveQuoteQuery = ({
  quoteId,
  cashuReceiveQuoteRepository,
}: {
  quoteId?: string;
  cashuReceiveQuoteRepository: CashuReceiveQuoteRepository;
}) =>
  ({
    queryKey: cashuReceiveQuoteQueryKey(quoteId),
    queryFn: () => {
      if (!quoteId) {
        throw new Error('Quote id is required');
      }

      return cashuReceiveQuoteRepository.get(quoteId);
    },
    staleTime: Number.POSITIVE_INFINITY,
  }) satisfies FetchQueryOptions<CashuReceiveQuote | null, Error>;

export const pendingCashuReceiveQuotesQuery = ({
  userId,
  cashuReceiveQuoteRepository,
  queryClient,
  getListAccountsQuery,
}: {
  userId: string;
  cashuReceiveQuoteRepository: CashuReceiveQuoteRepository;
  queryClient: QueryClient;
  getListAccountsQuery: () => FetchQueryOptions<Account[], Error>;
}) =>
  ({
    queryKey: pendingCashuReceiveQuotesQueryKey(),
    queryFn: async () => {
      const [quotes, accounts] = await Promise.all([
        cashuReceiveQuoteRepository.getPending(userId),
        queryClient.fetchQuery(getListAccountsQuery()),
      ]);

      const accountsById = new Map(
        accounts.map((account) => [account.id, account]),
      );

      return quotes.filter(
        (quote) => accountsById.get(quote.accountId)?.isOnline,
      );
    },
    staleTime: Number.POSITIVE_INFINITY,
  }) satisfies FetchQueryOptions<CashuReceiveQuote[], Error>;
