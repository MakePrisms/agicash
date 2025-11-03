import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import type { Money } from '~/lib/money';
import { useLatest } from '~/lib/use-latest';
import type { SparkAccount } from '../accounts/account';
import { useAccounts, useUpdateSparkBalance } from '../accounts/account-hooks';
import { useSparkWallet } from '../shared/spark';
import {
  type SparkLightningQuote,
  type SparkSendQuote,
  useSparkSendLightningService,
} from './spark-send-lightning-service';

class SparkSendQuoteCache {
  public static Key = 'spark-send-quote';

  constructor(private readonly queryClient: QueryClient) {}

  get(quoteId: string) {
    return this.queryClient.getQueryData<SparkSendQuote>([
      SparkSendQuoteCache.Key,
      quoteId,
    ]);
  }

  getActive() {
    const queries = this.queryClient.getQueriesData<SparkSendQuote>({
      queryKey: [SparkSendQuoteCache.Key],
    });
    return queries.find(([_, quote]) => quote?.state === 'PENDING')?.[1];
  }

  add(quote: SparkSendQuote) {
    this.queryClient.setQueryData<SparkSendQuote>(
      [SparkSendQuoteCache.Key, quote.id],
      quote,
    );
  }

  update(quote: SparkSendQuote) {
    this.queryClient.setQueryData<SparkSendQuote>(
      [SparkSendQuoteCache.Key, quote.id],
      quote,
    );
  }
}

function useSparkSendQuoteCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new SparkSendQuoteCache(queryClient), [queryClient]);
}

export function useCreateSparkLightningQuote() {
  const sparkSendLightningService = useSparkSendLightningService();

  return useMutation({
    mutationKey: ['create-spark-lightning-quote'],
    scope: {
      id: 'create-spark-lightning-quote',
    },
    mutationFn: async ({
      account,
      paymentRequest,
      amount,
    }: {
      account: SparkAccount;
      paymentRequest: string;
      amount?: Money;
    }) => {
      return sparkSendLightningService.getLightningQuote({
        account,
        paymentRequest,
        amount,
      });
    },
    retry: 1,
    throwOnError: true,
  });
}

export function usePaySparkLightningInvoice() {
  const sparkSendLightningService = useSparkSendLightningService();
  const cache = useSparkSendQuoteCache();

  return useMutation({
    mutationKey: ['pay-spark-lightning-invoice'],
    scope: {
      id: 'pay-spark-lightning-invoice',
    },
    mutationFn: async ({
      account,
      quote,
    }: {
      account: SparkAccount;
      quote: SparkLightningQuote;
    }) => {
      return sparkSendLightningService.payLightningInvoice({
        account,
        quote,
      });
    },
    onSuccess: (quote) => {
      cache.add(quote);
    },
    throwOnError: true,
  });
}

type UseTrackSparkLightningSendProps = {
  quoteId?: string;
  onCompleted?: (quote: SparkSendQuote) => void;
  onFailed?: (quote: SparkSendQuote) => void;
};

type UseTrackSparkLightningSendResponse =
  | {
      status: 'DISABLED' | 'LOADING';
      quote?: undefined;
    }
  | {
      status: SparkSendQuote['state'];
      quote: SparkSendQuote;
    };

export function useTrackSparkLightningSend({
  quoteId = '',
  onCompleted,
  onFailed,
}: UseTrackSparkLightningSendProps): UseTrackSparkLightningSendResponse {
  const cache = useSparkSendQuoteCache();
  const { data: accounts } = useAccounts({ type: 'spark' });
  const sparkSendLightningService = useSparkSendLightningService();
  const sparkWallet = useSparkWallet();
  const onCompletedRef = useLatest(onCompleted);
  const onFailedRef = useLatest(onFailed);
  const updateSparkBalance = useUpdateSparkBalance();
  // TODO: ensures callbacks are only invoked once per quote, but we should make this more stable so
  // that this ref is not needed.
  const lastHandledStateRef = useRef<string | null>(null);

  const { data: quote } = useQuery({
    queryKey: [SparkSendQuoteCache.Key, quoteId],
    queryFn: async () => {
      const cachedQuote = cache.get(quoteId);
      if (!cachedQuote) return null;

      // Don't poll if already in terminal state
      if (cachedQuote.state === 'COMPLETED' || cachedQuote.state === 'FAILED') {
        return cachedQuote;
      }

      try {
        const account = accounts?.find((a) => a.id === cachedQuote.accountId);
        if (!account) return cachedQuote;

        const sendRequest = await sparkWallet.getLightningSendRequest(
          cachedQuote.id,
        );
        if (!sendRequest) throw new Error('Send request not found');
        const state = sparkSendLightningService.mapStatusToState(
          sendRequest.status,
        );

        if (state !== cachedQuote.state) {
          const updatedQuote: SparkSendQuote = {
            ...cachedQuote,
            state,
            sendRequest,
            transferId: sendRequest.transfer?.sparkId,
          };
          cache.update(updatedQuote);
          const newBalance = await sparkWallet.getBalance();
          updateSparkBalance(account.id, newBalance.balance);
          return updatedQuote;
        }

        return cachedQuote;
      } catch (error) {
        console.error('Error polling Spark send quote:', error);
        return cachedQuote;
      }
    },
    staleTime: 0,
    gcTime: 0,
    enabled: !!quoteId && !!accounts?.length,
    retry: false,
    refetchInterval: (query) => {
      const quote = query.state.data;
      // Stop polling if in terminal state
      if (quote?.state === 'COMPLETED' || quote?.state === 'FAILED') {
        return false;
      }
      return 5 * 1000; // Poll every 5 seconds
    },
    refetchIntervalInBackground: true,
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

  if (!quoteId) {
    return { status: 'DISABLED' };
  }

  if (!quote) {
    return { status: 'LOADING' };
  }

  return {
    status: quote.state,
    quote,
  };
}

/**
 * Hook to listen for transfer:claimed events on Spark accounts for send operations.
 * Updates balance and completes send quotes when transfers are claimed.
 */
// export function useSparkSendBalanceUpdates() {
// TODO: this doesnt work. For some reason the transfer:claimed event is not being triggered.
// It works for receives but not for sends. Right now we are polling the status of the send quote.
//
//
//   const { data: accounts } = useAccounts({ type: 'spark' });
//   const updateSparkBalance = useUpdateSparkBalance();
//   const cache = useSparkSendQuoteCache();
//   const handleTransferClaimed = useCallback(
//     async (accountId: string, transferId: string, balance: bigint) => {
//       const account = accounts?.find((a) => a.id === accountId);
//       if (!account) return;
//       const transfer = await account.wallet.getTransfer(transferId);
//       if (!transfer || transfer.transferDirection !== 'OUTGOING')
//         throw new Error('Transfer is not outgoing');
//       console.log('handleTransferClaimed', accountId, transferId, balance);
//       updateSparkBalance(accountId, balance);
//       const sendRequestId = transfer.userRequest?.id;
//       if (!sendRequestId) throw new Error('Send request ID not found');
//       const activeQuote = cache.get(sendRequestId);
//       if (!activeQuote || activeQuote.accountId !== accountId)
//         throw new Error('Active quote not found');
//       try {
//         const updatedQuote: SparkSendQuote = {
//           ...activeQuote,
//           state: 'COMPLETED',
//           transferId,
//         };
//         cache.update(updatedQuote);
//       } catch (error) {
//         console.error('Error fetching transfer for send quote:', error);
//       }
//     },
//     [updateSparkBalance, cache, accounts],
//   );
//   const handleTransferClaimedRef = useLatest(handleTransferClaimed);
//   useEffect(() => {
//     if (!accounts?.length) return;
//     const sparkAccounts = accounts.filter(
//       (account) => account.type === 'spark',
//     );
//     const handlers = new Map<
//       string,
//       (transferId: string, balance: bigint) => void
//     >();
//     for (const account of sparkAccounts) {
//       const handler = (transferId: string, balance: bigint) => {
//         handleTransferClaimedRef.current(account.id, transferId, balance);
//       };
//       handlers.set(account.id, handler);
//       account.wallet.on('transfer:claimed', handler);
//       console.log('num listeners', account.wallet.listeners('transfer:claimed').length);
//     }
//     return () => {
//       for (const account of sparkAccounts) {
//         const handler = handlers.get(account.id);
//         if (handler) {
//           account.wallet.off('transfer:claimed', handler);
//         }
//       }
//     };
//   }, [accounts]);
// }
