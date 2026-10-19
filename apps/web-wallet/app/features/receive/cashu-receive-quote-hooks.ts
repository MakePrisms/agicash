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
  const transactionsCache = useTransactionsCache();

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
      transactionsCache.invalidateTransaction(data.transactionId);
      onPaidRef.current?.(data);
    } else if (data.state === 'EXPIRED') {
      onExpiredRef.current?.(data);
    }
  }, [data, transactionsCache]);

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

  return {
    'cashu-receive-quote.updated': ({ quote }) => {
      cashuReceiveQuoteCache.updateIfExists(quote);
    },
  };
}
