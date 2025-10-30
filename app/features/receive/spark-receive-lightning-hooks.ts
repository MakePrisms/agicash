import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Money } from '~/lib/money';
import { useLatest } from '~/lib/use-latest';
import type { SparkAccount } from '../accounts/account';
import { useAccounts, useUpdateSparkBalance } from '../accounts/account-hooks';
import { useSparkWallet } from '../shared/spark';
import {
  type SparkReceiveQuote,
  useSparkReceiveLightningService,
} from './spark-receive-lightning-service';

type CreateSparkReceiveLightningQuoteProps = {
  account: SparkAccount;
  amount: Money;
  receiverIdentityPubkey?: string;
};

class SparkReceiveQuoteCache {
  public static Key = 'spark-receive-quote';

  constructor(private readonly queryClient: QueryClient) {}

  get(quoteId: string) {
    return this.queryClient.getQueryData<SparkReceiveQuote>([
      SparkReceiveQuoteCache.Key,
      quoteId,
    ]);
  }

  /**
   * Get the active quote (should only be one)
   */
  getActive() {
    const queries = this.queryClient.getQueriesData<SparkReceiveQuote>({
      queryKey: [SparkReceiveQuoteCache.Key],
    });
    return queries.find(([_, quote]) => quote?.state === 'PENDING')?.[1];
  }

  add(quote: SparkReceiveQuote) {
    this.queryClient.setQueryData<SparkReceiveQuote>(
      [SparkReceiveQuoteCache.Key, quote.id],
      quote,
    );
  }

  update(quote: SparkReceiveQuote) {
    this.queryClient.setQueryData<SparkReceiveQuote>(
      [SparkReceiveQuoteCache.Key, quote.id],
      quote,
    );
  }
}

function useSparkReceiveQuoteCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new SparkReceiveQuoteCache(queryClient), [queryClient]);
}

export function useCreateSparkReceiveLightningQuote() {
  const sparkReceiveLightningService = useSparkReceiveLightningService();
  const cache = useSparkReceiveQuoteCache();

  return useMutation({
    mutationFn: async ({
      account,
      amount,
      receiverIdentityPubkey,
    }: CreateSparkReceiveLightningQuoteProps) => {
      return sparkReceiveLightningService.getLightningQuote({
        account,
        amount,
        receiverIdentityPubkey,
      });
    },
    onSuccess: (quote) => {
      cache.add(quote);
    },
  });
}

type UseSparkReceiveQuoteProps = {
  quoteId?: string;
  onCompleted?: (quote: SparkReceiveQuote) => void;
  onFailed?: (quote: SparkReceiveQuote) => void;
};

type UseSparkReceiveQuoteResponse =
  | {
      status: 'LOADING';
      quote?: undefined;
    }
  | {
      status: SparkReceiveQuote['state'];
      quote: SparkReceiveQuote;
    };

export function useSparkReceiveQuote({
  quoteId,
  onCompleted,
  onFailed,
}: UseSparkReceiveQuoteProps): UseSparkReceiveQuoteResponse {
  const cache = useSparkReceiveQuoteCache();
  const onCompletedRef = useLatest(onCompleted);
  const onFailedRef = useLatest(onFailed);
  // TODO: ensures callbacks are only invoked once per quote, but we should make this more stable so
  // that this ref is not needed.
  const lastHandledStateRef = useRef<string | null>(null);

  const { data: quote } = useQuery({
    queryKey: [SparkReceiveQuoteCache.Key, quoteId],
    queryFn: () => (quoteId ? cache.get(quoteId) : undefined),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: !!quoteId,
  });

  useEffect(() => {
    if (!quote || quote.state === 'PENDING') return;
    if (lastHandledStateRef.current === quote.id) return;

    lastHandledStateRef.current = quote.id;

    if (quote.state === 'COMPLETED') {
      onCompletedRef.current?.(quote);
    } else if (quote.state === 'FAILED') {
      onFailedRef.current?.(quote);
    }
  }, [quote]);

  if (!quote) {
    return { status: 'LOADING' };
  }

  return {
    status: quote.state,
    quote,
  };
}

export function useTrackSparkReceives() {
  const { data: accounts } = useAccounts({ type: 'spark' });
  const updateSparkBalance = useUpdateSparkBalance();
  const cache = useSparkReceiveQuoteCache();
  const sparkWallet = useSparkWallet();

  const handleTransferClaimed = useCallback(
    async (transferId: string, balance: bigint) => {
      console.debug('handleTransferClaimed', transferId, balance);
      // TODO: we're just assming one spark account total.
      const sparkAccount = accounts?.[0];
      if (!sparkAccount) return;

      updateSparkBalance(sparkAccount.id, balance);

      const activeQuote = cache.getActive();
      if (!activeQuote || activeQuote.accountId !== sparkAccount.id) return;

      try {
        const transfer = await sparkWallet.getTransfer(transferId);

        if (transfer && transfer.id === transferId) {
          const updatedQuote: SparkReceiveQuote = {
            ...activeQuote,
            state: 'COMPLETED',
            transferId,
          };
          cache.update(updatedQuote);
        }
      } catch (error) {
        console.error('Error fetching transfer for quote:', error);
      }
    },
    [updateSparkBalance, cache, accounts, sparkWallet],
  );

  const handleTransferClaimedRef = useLatest(handleTransferClaimed);

  useEffect(() => {
    if (!accounts?.length) return;

    sparkWallet.on('transfer:claimed', handleTransferClaimedRef.current);

    return () => {
      sparkWallet.off('transfer:claimed', handleTransferClaimedRef.current);
    };
  }, [accounts, sparkWallet]);
}
