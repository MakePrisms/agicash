import type { Money } from '@agicash/money';
import type {
  CashuAccount,
  CashuReceiveQuote,
  TransactionPurpose,
} from '@agicash/wallet-sdk';
import { CashuReceiveQuoteRepository } from '@agicash/wallet-sdk/temporary';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useAccountRepository } from '~/features/accounts/account-repository-hooks';
import { sdk } from '~/features/shared/sdk.client';
import { useLatest } from '~/lib/use-latest';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption-hooks';
import { useTransactionsCache } from '../transactions/transaction-hooks';
import type { WalletChangeHandlers } from '../wallet/use-track-wallet-changes';

type CreateProps = {
  account: CashuAccount;
  amount: Money;
  description?: string;
  purpose?: TransactionPurpose;
  transferId?: string;
};

export function useCashuReceiveQuoteRepository() {
  const encryption = useEncryption();
  const accountRepository = useAccountRepository();
  return new CashuReceiveQuoteRepository(
    agicashDbClient,
    encryption,
    accountRepository,
  );
}

class CashuReceiveQuoteCache {
  // Query that tracks the "active" cashu receive quote. Active one is the one that user created in current browser session.
  // We want to track active quote even after it is expired and completed which is why we can't use pending quotes query.
  // Pending quotes query is used for active pending quote plus "background" pending quotes. "Background" quotes are quotes
  // that were created in previous browser sessions.
  public static Key = 'cashu-receive-quote';

  constructor(private readonly queryClient: QueryClient) {}

  get(quoteId: string) {
    return this.queryClient.getQueryData<CashuReceiveQuote>([
      CashuReceiveQuoteCache.Key,
      quoteId,
    ]);
  }

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

export function useCreateCashuReceiveQuote() {
  const cashuReceiveQuoteCache = useCashuReceiveQuoteCache();

  return useMutation({
    scope: {
      id: 'create-cashu-receive-quote',
    },
    mutationFn: async ({
      account,
      amount,
      description,
      purpose,
      transferId,
    }: CreateProps) => {
      const lightningQuote = await sdk.receive.cashu.getLightningQuote({
        account,
        amount,
        description,
      });
      return sdk.receive.cashu.createQuote({
        account,
        lightningQuote,
        purpose,
        transferId,
      });
    },
    onSuccess: (data) => {
      cashuReceiveQuoteCache.add(data);
    },
    retry: 1,
  });
}

export function useCashuReceiveQuoteCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new CashuReceiveQuoteCache(queryClient), [queryClient]);
}

type UseTrackCashuReceiveQuoteProps = {
  quoteId?: string;
  onPaid?: (quote: CashuReceiveQuote) => void;
  onExpired?: (quote: CashuReceiveQuote) => void;
};

type UseTrackCashuReceiveQuoteResponse =
  | {
      status: 'LOADING';
      quote?: undefined;
    }
  | {
      status: CashuReceiveQuote['state'];
      quote: CashuReceiveQuote;
    };

export function useTrackCashuReceiveQuote({
  quoteId,
  onPaid,
  onExpired,
}: UseTrackCashuReceiveQuoteProps): UseTrackCashuReceiveQuoteResponse {
  const enabled = !!quoteId;
  const onPaidRef = useLatest(onPaid);
  const onExpiredRef = useLatest(onExpired);

  const { data } = useQuery({
    queryKey: [CashuReceiveQuoteCache.Key, quoteId],
    // biome-ignore lint/style/noNonNullAssertion: quoteId is guaranteed by enabled
    queryFn: () => sdk.receive.cashu.getQuote(quoteId!),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    enabled,
  });

  useEffect(() => {
    if (!data) return;

    if (data.state === 'COMPLETED') {
      onPaidRef.current?.(data);
    } else if (data.state === 'EXPIRED') {
      onExpiredRef.current?.(data);
    }
  }, [data]);

  if (!data) {
    return { status: 'LOADING' };
  }

  return {
    status: data.state,
    quote: data,
  };
}

/**
 * Hook that returns a cashu receive quote change handler.
 */
export function useCashuReceiveQuoteChangeHandlers(): WalletChangeHandlers<'cashu-receive-quote.updated'> {
  const cashuReceiveQuoteCache = useCashuReceiveQuoteCache();
  const transactionsCache = useTransactionsCache();

  return {
    'cashu-receive-quote.updated': ({ quote }) => {
      const tracked = cashuReceiveQuoteCache.get(quote.id);
      if (
        tracked &&
        tracked.version < quote.version &&
        quote.state === 'COMPLETED'
      ) {
        // Updating the quote navigates to the transaction page; refetch the
        // transaction now so the page does not show the cached DRAFT row while
        // the transaction's own realtime update is delayed.
        transactionsCache.invalidateTransaction(quote.transactionId);
      }
      cashuReceiveQuoteCache.updateIfExists(quote);
    },
  };
}
