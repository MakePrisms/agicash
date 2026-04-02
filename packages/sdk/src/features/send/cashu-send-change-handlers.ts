import type {
  AgicashDbCashuProof,
  AgicashDbCashuSendQuote,
  AgicashDbCashuSendSwap,
} from '../../db/database';
import type { DatabaseChangeHandler } from '../wallet/database-change-handler';
import type { UnresolvedCashuSendQuotesCache } from './cashu-send-quote-queries';
import type { CashuSendQuoteRepository } from './cashu-send-quote-repository';
import type {
  CashuSendSwapCache,
  UnresolvedCashuSendSwapsCache,
} from './cashu-send-swap-queries';
import type { CashuSendSwapRepository } from './cashu-send-swap-repository';

export function createCashuSendQuoteChangeHandlers(
  cashuSendQuoteRepo: CashuSendQuoteRepository,
  unresolvedCashuSendQuotesCache: UnresolvedCashuSendQuotesCache,
): DatabaseChangeHandler[] {
  return [
    {
      event: 'CASHU_SEND_QUOTE_CREATED',
      handleEvent: async (payload) => {
        const quote = await cashuSendQuoteRepo.toQuote(
          payload as AgicashDbCashuSendQuote & {
            cashu_proofs: AgicashDbCashuProof[];
          },
        );
        unresolvedCashuSendQuotesCache.add(quote);
      },
    },
    {
      event: 'CASHU_SEND_QUOTE_UPDATED',
      handleEvent: async (payload) => {
        const quote = await cashuSendQuoteRepo.toQuote(
          payload as AgicashDbCashuSendQuote & {
            cashu_proofs: AgicashDbCashuProof[];
          },
        );
        if (quote.state === 'UNPAID' || quote.state === 'PENDING') {
          unresolvedCashuSendQuotesCache.update(quote);
        } else {
          unresolvedCashuSendQuotesCache.remove(quote);
        }
      },
    },
  ];
}

export function createCashuSendSwapChangeHandlers(
  cashuSendSwapRepo: CashuSendSwapRepository,
  cashuSendSwapCache: CashuSendSwapCache,
  unresolvedCashuSendSwapsCache: UnresolvedCashuSendSwapsCache,
): DatabaseChangeHandler[] {
  return [
    {
      event: 'CASHU_SEND_SWAP_CREATED',
      handleEvent: async (payload) => {
        const swap = await cashuSendSwapRepo.toSwap(
          payload as AgicashDbCashuSendSwap & {
            cashu_proofs: AgicashDbCashuProof[];
          },
        );
        unresolvedCashuSendSwapsCache.add(swap);
      },
    },
    {
      event: 'CASHU_SEND_SWAP_UPDATED',
      handleEvent: async (payload) => {
        const swap = await cashuSendSwapRepo.toSwap(
          payload as AgicashDbCashuSendSwap & {
            cashu_proofs: AgicashDbCashuProof[];
          },
        );
        cashuSendSwapCache.updateIfExists(swap);
        if (swap.state === 'DRAFT' || swap.state === 'PENDING') {
          unresolvedCashuSendSwapsCache.update(swap);
        } else {
          unresolvedCashuSendSwapsCache.remove(swap);
        }
      },
    },
  ];
}
