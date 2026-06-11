import type { AgicashDbCashuReceiveQuote } from '@agicash/db-types';
import type { QueryClient } from '@tanstack/query-core';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import type { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';

export class CashuReceiveQuoteCache {
  // Query that tracks the "active" cashu receive quote. Active one is the one that user created in current browser session.
  // We want to track active quote even after it is expired and completed which is why we can't use pending quotes query.
  // Pending quotes query is used for active pending quote plus "background" pending quotes. "Background" quotes are quotes
  // that were created in previous browser sessions.
  public static Key = 'cashu-receive-quote';

  constructor(private readonly queryClient: QueryClient) {}

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [CashuReceiveQuoteCache.Key],
    });
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

export function createCashuReceiveQuoteChangeHandlers(
  cashuReceiveQuoteRepository: CashuReceiveQuoteRepository,
  cashuReceiveQuoteCache: CashuReceiveQuoteCache,
  pendingQuotesCache: PendingCashuReceiveQuotesCache,
) {
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
