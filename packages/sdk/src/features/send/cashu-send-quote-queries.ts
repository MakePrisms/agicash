import type { FetchQueryOptions, QueryClient } from '@tanstack/query-core';
import { unresolvedCashuSendQuotesQueryKey } from '../../core/query-keys';
import type { Account } from '../accounts/account';
import type { CashuSendQuote } from './cashu-send-quote';
import type { CashuSendQuoteRepository } from './cashu-send-quote-repository';

export class UnresolvedCashuSendQuotesCache {
  static Key = 'unresolved-cashu-send-quotes';

  constructor(private readonly queryClient: QueryClient) {}

  get(sendQuoteId: string) {
    return this.queryClient
      .getQueryData<CashuSendQuote[]>(unresolvedCashuSendQuotesQueryKey())
      ?.find((q) => q.id === sendQuoteId);
  }

  getByMeltQuoteId(meltQuoteId: string) {
    const quotes = this.queryClient.getQueryData<CashuSendQuote[]>(
      unresolvedCashuSendQuotesQueryKey(),
    );
    return quotes?.find((q) => q.quoteId === meltQuoteId);
  }

  add(quote: CashuSendQuote) {
    this.queryClient.setQueryData<CashuSendQuote[]>(
      unresolvedCashuSendQuotesQueryKey(),
      (curr) => [...(curr ?? []), quote],
    );
  }

  update(quote: CashuSendQuote) {
    this.queryClient.setQueryData<CashuSendQuote[]>(
      unresolvedCashuSendQuotesQueryKey(),
      (curr) =>
        curr?.map((q) =>
          q.id === quote.id && q.version < quote.version ? quote : q,
        ),
    );
  }

  remove(quote: CashuSendQuote) {
    this.queryClient.setQueryData<CashuSendQuote[]>(
      unresolvedCashuSendQuotesQueryKey(),
      (curr) => curr?.filter((q) => q.id !== quote.id),
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: unresolvedCashuSendQuotesQueryKey(),
    });
  }
}

export const unresolvedCashuSendQuotesQuery = ({
  userId,
  cashuSendQuoteRepository,
  queryClient,
  getListAccountsQuery,
}: {
  userId: string;
  cashuSendQuoteRepository: CashuSendQuoteRepository;
  queryClient: QueryClient;
  getListAccountsQuery: () => FetchQueryOptions<Account[], Error>;
}) =>
  ({
    queryKey: unresolvedCashuSendQuotesQueryKey(),
    queryFn: async () => {
      const [quotes, accounts] = await Promise.all([
        cashuSendQuoteRepository.getUnresolved(userId),
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
  }) satisfies FetchQueryOptions<CashuSendQuote[], Error>;
