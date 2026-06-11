import type {
  AgicashDbCashuProof,
  AgicashDbCashuSendQuote,
} from '@agicash/db-types';
import type { QueryClient } from '@tanstack/query-core';
import type { CashuSendQuote } from './cashu-send-quote';
import type { CashuSendQuoteRepository } from './cashu-send-quote-repository';

export class UnresolvedCashuSendQuotesCache {
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

export function createCashuSendQuoteChangeHandlers(
  cashuSendQuoteRepository: CashuSendQuoteRepository,
  unresolvedSendQuotesCache: UnresolvedCashuSendQuotesCache,
) {
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
