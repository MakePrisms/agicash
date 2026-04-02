import type { FetchQueryOptions, QueryClient } from '@tanstack/query-core';
import {
  pendingSparkReceiveQuotesQueryKey,
  sparkReceiveQuoteQueryKey,
} from '../../core/query-keys';
import type { Account } from '../accounts/account';
import type { SparkReceiveQuote } from './spark-receive-quote';
import type { SparkReceiveQuoteRepository } from './spark-receive-quote-repository';

export class SparkReceiveQuoteCache {
  constructor(private readonly queryClient: QueryClient) {}

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: sparkReceiveQuoteQueryKey(),
    });
  }

  add(quote: SparkReceiveQuote) {
    this.queryClient.setQueryData<SparkReceiveQuote>(
      sparkReceiveQuoteQueryKey(quote.id),
      quote,
    );
  }

  updateIfExists(quote: SparkReceiveQuote) {
    this.queryClient.setQueryData<SparkReceiveQuote>(
      sparkReceiveQuoteQueryKey(quote.id),
      (curr) => (curr && curr.version < quote.version ? quote : undefined),
    );
  }
}

export class PendingSparkReceiveQuotesCache {
  constructor(private readonly queryClient: QueryClient) {}

  get(quoteId: string) {
    return this.queryClient
      .getQueryData<SparkReceiveQuote[]>(pendingSparkReceiveQuotesQueryKey())
      ?.find((q) => q.id === quoteId);
  }

  getByMeltQuoteId(
    meltQuoteId: string,
  ): (SparkReceiveQuote & { type: 'CASHU_TOKEN' }) | undefined {
    const quotes = this.queryClient.getQueryData<SparkReceiveQuote[]>(
      pendingSparkReceiveQuotesQueryKey(),
    );
    return quotes?.find(
      (q): q is SparkReceiveQuote & { type: 'CASHU_TOKEN' } =>
        q.type === 'CASHU_TOKEN' &&
        q.tokenReceiveData.meltQuoteId === meltQuoteId,
    );
  }

  add(quote: SparkReceiveQuote) {
    this.queryClient.setQueryData<SparkReceiveQuote[]>(
      pendingSparkReceiveQuotesQueryKey(),
      (curr = []) => [...curr, quote],
    );
  }

  update(quote: SparkReceiveQuote) {
    this.queryClient.setQueryData<SparkReceiveQuote[]>(
      pendingSparkReceiveQuotesQueryKey(),
      (curr) =>
        curr?.map((q) =>
          q.id === quote.id && q.version < quote.version ? quote : q,
        ),
    );
  }

  remove(quote: SparkReceiveQuote) {
    this.queryClient.setQueryData<SparkReceiveQuote[]>(
      pendingSparkReceiveQuotesQueryKey(),
      (curr) => curr?.filter((q) => q.id !== quote.id),
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: pendingSparkReceiveQuotesQueryKey(),
    });
  }
}

export const sparkReceiveQuoteQuery = ({
  quoteId,
  sparkReceiveQuoteRepository,
}: {
  quoteId?: string;
  sparkReceiveQuoteRepository: SparkReceiveQuoteRepository;
}) =>
  ({
    queryKey: sparkReceiveQuoteQueryKey(quoteId),
    queryFn: () => {
      if (!quoteId) {
        throw new Error('Quote id is required');
      }

      return sparkReceiveQuoteRepository.get(quoteId);
    },
    staleTime: Number.POSITIVE_INFINITY,
  }) satisfies FetchQueryOptions<SparkReceiveQuote | null, Error>;

export const pendingSparkReceiveQuotesQuery = ({
  userId,
  sparkReceiveQuoteRepository,
  queryClient,
  getListAccountsQuery,
}: {
  userId: string;
  sparkReceiveQuoteRepository: SparkReceiveQuoteRepository;
  queryClient: QueryClient;
  getListAccountsQuery: () => FetchQueryOptions<Account[], Error>;
}) =>
  ({
    queryKey: pendingSparkReceiveQuotesQueryKey(),
    queryFn: async () => {
      const [quotes, accounts] = await Promise.all([
        sparkReceiveQuoteRepository.getPending(userId),
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
  }) satisfies FetchQueryOptions<SparkReceiveQuote[], Error>;
