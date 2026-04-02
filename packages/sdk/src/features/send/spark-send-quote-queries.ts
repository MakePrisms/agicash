import type { FetchQueryOptions, QueryClient } from '@tanstack/query-core';
import { unresolvedSparkSendQuotesQueryKey } from '../../core/query-keys';
import type { Account } from '../accounts/account';
import type { SparkSendQuote } from './spark-send-quote';
import type { SparkSendQuoteRepository } from './spark-send-quote-repository';

export class UnresolvedSparkSendQuotesCache {
  static Key = 'unresolved-spark-send-quotes';

  constructor(private readonly queryClient: QueryClient) {}

  get(quoteId: string) {
    return this.queryClient
      .getQueryData<SparkSendQuote[]>(unresolvedSparkSendQuotesQueryKey())
      ?.find((q) => q.id === quoteId);
  }

  add(quote: SparkSendQuote) {
    this.queryClient.setQueryData<SparkSendQuote[]>(
      unresolvedSparkSendQuotesQueryKey(),
      (curr) => [...(curr ?? []), quote],
    );
  }

  update(quote: SparkSendQuote) {
    this.queryClient.setQueryData<SparkSendQuote[]>(
      unresolvedSparkSendQuotesQueryKey(),
      (curr) =>
        curr?.map((q) =>
          q.id === quote.id && q.version < quote.version ? quote : q,
        ),
    );
  }

  remove(quote: SparkSendQuote) {
    this.queryClient.setQueryData<SparkSendQuote[]>(
      unresolvedSparkSendQuotesQueryKey(),
      (curr) => curr?.filter((q) => q.id !== quote.id),
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: unresolvedSparkSendQuotesQueryKey(),
    });
  }
}

export const unresolvedSparkSendQuotesQuery = ({
  userId,
  sparkSendQuoteRepository,
  queryClient,
  getListAccountsQuery,
}: {
  userId: string;
  sparkSendQuoteRepository: SparkSendQuoteRepository;
  queryClient: QueryClient;
  getListAccountsQuery: () => FetchQueryOptions<Account[], Error>;
}) =>
  ({
    queryKey: unresolvedSparkSendQuotesQueryKey(),
    queryFn: async () => {
      const [quotes, accounts] = await Promise.all([
        sparkSendQuoteRepository.getUnresolved(userId),
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
  }) satisfies FetchQueryOptions<SparkSendQuote[], Error>;
