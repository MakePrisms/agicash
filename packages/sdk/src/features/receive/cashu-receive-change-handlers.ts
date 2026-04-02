import type {
  AgicashDbCashuReceiveQuote,
  AgicashDbCashuReceiveSwap,
} from '../../db/database';
import type { DatabaseChangeHandler } from '../wallet/database-change-handler';
import type {
  CashuReceiveQuoteCache,
  PendingCashuReceiveQuotesCache,
} from './cashu-receive-queries';
import type { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';
import type { PendingCashuReceiveSwapsCache } from './cashu-receive-swap-queries';
import type { CashuReceiveSwapRepository } from './cashu-receive-swap-repository';

export function createCashuReceiveQuoteChangeHandlers(
  cashuReceiveQuoteRepo: CashuReceiveQuoteRepository,
  cashuReceiveQuoteCache: CashuReceiveQuoteCache,
  pendingCashuReceiveQuotesCache: PendingCashuReceiveQuotesCache,
): DatabaseChangeHandler[] {
  return [
    {
      event: 'CASHU_RECEIVE_QUOTE_CREATED',
      handleEvent: async (payload) => {
        const quote = await cashuReceiveQuoteRepo.toQuote(
          payload as AgicashDbCashuReceiveQuote,
        );
        pendingCashuReceiveQuotesCache.add(quote);
      },
    },
    {
      event: 'CASHU_RECEIVE_QUOTE_UPDATED',
      handleEvent: async (payload) => {
        const quote = await cashuReceiveQuoteRepo.toQuote(
          payload as AgicashDbCashuReceiveQuote,
        );
        cashuReceiveQuoteCache.updateIfExists(quote);
        if (quote.state === 'UNPAID' || quote.state === 'PAID') {
          pendingCashuReceiveQuotesCache.update(quote);
        } else {
          pendingCashuReceiveQuotesCache.remove(quote);
        }
      },
    },
  ];
}

export function createCashuReceiveSwapChangeHandlers(
  cashuReceiveSwapRepo: CashuReceiveSwapRepository,
  pendingCashuReceiveSwapsCache: PendingCashuReceiveSwapsCache,
): DatabaseChangeHandler[] {
  return [
    {
      event: 'CASHU_RECEIVE_SWAP_CREATED',
      handleEvent: async (payload) => {
        const swap = await cashuReceiveSwapRepo.toReceiveSwap(
          payload as AgicashDbCashuReceiveSwap,
        );
        pendingCashuReceiveSwapsCache.add(swap);
      },
    },
    {
      event: 'CASHU_RECEIVE_SWAP_UPDATED',
      handleEvent: async (payload) => {
        const swap = await cashuReceiveSwapRepo.toReceiveSwap(
          payload as AgicashDbCashuReceiveSwap,
        );
        if (swap.state === 'PENDING') {
          pendingCashuReceiveSwapsCache.update(swap);
        } else {
          pendingCashuReceiveSwapsCache.remove(swap);
        }
      },
    },
  ];
}
