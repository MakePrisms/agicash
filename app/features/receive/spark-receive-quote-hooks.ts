import type { Payment } from '@agicash/breez-sdk-spark';
import { MintOperationError, NetworkError } from '@cashu/cashu-ts';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import {
  type ExtendedCashuWallet,
  getCashuUnit,
  getCashuWallet,
  sumProofs,
  useOnMeltQuoteStateChange,
} from '~/lib/cashu';
import type { Money } from '~/lib/money';
import { useLatest } from '~/lib/use-latest';
import type { SparkAccount } from '../accounts/account';
import {
  useGetCashuAccountByMintUrlAndCurrency,
  useGetSparkAccount,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import type { AgicashDbSparkReceiveQuote } from '../agicash-db/database';
import { getInitializedCashuWallet } from '../shared/cashu';
import { sparkDebugLog } from '../shared/spark';
import type { TransactionPurpose } from '../transactions/transaction-enums';
import { useTransactionsCache } from '../transactions/transaction-hooks';
import { useUser } from '../user/user-hooks';
import type { SparkReceiveQuote } from './spark-receive-quote';
import { getLightningQuote } from './spark-receive-quote-core';
import { useSparkReceiveQuoteRepository } from './spark-receive-quote-repository';
import { useSparkReceiveQuoteService } from './spark-receive-quote-service';

class SparkReceiveQuoteCache {
  // Query that tracks the "active" spark receive quote. Active one is the one that user created in current browser session.
  // We want to track active quote even after it is expired and completed which is why we can't use pending quotes query.
  // Pending quotes query is used for active pending quote plus "background" pending quotes. "Background" quotes are quotes
  // that were created in previous browser sessions.
  public static Key = 'spark-receive-quote';

  constructor(private readonly queryClient: QueryClient) {}

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [SparkReceiveQuoteCache.Key],
    });
  }

  add(quote: SparkReceiveQuote) {
    this.queryClient.setQueryData<SparkReceiveQuote>(
      [SparkReceiveQuoteCache.Key, quote.id],
      quote,
    );
  }

  updateIfExists(quote: SparkReceiveQuote) {
    this.queryClient.setQueryData<SparkReceiveQuote>(
      [SparkReceiveQuoteCache.Key, quote.id],
      (curr) => (curr && curr.version < quote.version ? quote : undefined),
    );
  }
}

export function useSparkReceiveQuoteCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new SparkReceiveQuoteCache(queryClient), [queryClient]);
}

type UseSparkReceiveQuoteProps = {
  quoteId?: string;
  onPaid?: (quote: SparkReceiveQuote) => void;
  onExpired?: (quote: SparkReceiveQuote) => void;
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
  onPaid,
  onExpired,
}: UseSparkReceiveQuoteProps): UseSparkReceiveQuoteResponse {
  const enabled = !!quoteId;
  const onPaidRef = useLatest(onPaid);
  const onExpiredRef = useLatest(onExpired);
  const sparkReceiveQuoteRepository = useSparkReceiveQuoteRepository();

  const { data } = useQuery({
    queryKey: [SparkReceiveQuoteCache.Key, quoteId],
    // biome-ignore lint/style/noNonNullAssertion: quoteId is guaranteed by enabled
    queryFn: () => sparkReceiveQuoteRepository.get(quoteId!),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    enabled,
  });

  useEffect(() => {
    if (!data) return;

    if (data.state === 'PAID') {
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

export class PendingSparkReceiveQuotesCache {
  public static Key = 'pending-spark-receive-quotes';

  constructor(private readonly queryClient: QueryClient) {}

  get(quoteId: string) {
    return this.queryClient
      .getQueryData<SparkReceiveQuote[]>([PendingSparkReceiveQuotesCache.Key])
      ?.find((q) => q.id === quoteId);
  }

  getByMeltQuoteId(
    meltQuoteId: string,
  ): (SparkReceiveQuote & { type: 'CASHU_TOKEN' }) | undefined {
    const quotes = this.queryClient.getQueryData<SparkReceiveQuote[]>([
      PendingSparkReceiveQuotesCache.Key,
    ]);
    return quotes?.find(
      (q): q is SparkReceiveQuote & { type: 'CASHU_TOKEN' } =>
        q.type === 'CASHU_TOKEN' &&
        q.tokenReceiveData.meltQuoteId === meltQuoteId,
    );
  }

  add(quote: SparkReceiveQuote) {
    this.queryClient.setQueryData<SparkReceiveQuote[]>(
      [PendingSparkReceiveQuotesCache.Key],
      (curr) => [...(curr ?? []), quote],
    );
  }

  update(quote: SparkReceiveQuote) {
    this.queryClient.setQueryData<SparkReceiveQuote[]>(
      [PendingSparkReceiveQuotesCache.Key],
      (curr) =>
        curr?.map((q) =>
          q.id === quote.id && q.version < quote.version ? quote : q,
        ),
    );
  }

  remove(quote: SparkReceiveQuote) {
    this.queryClient.setQueryData<SparkReceiveQuote[]>(
      [PendingSparkReceiveQuotesCache.Key],
      (curr) => curr?.filter((q) => q.id !== quote.id),
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [PendingSparkReceiveQuotesCache.Key],
    });
  }
}

export function usePendingSparkReceiveQuotesCache() {
  const queryClient = useQueryClient();
  return useMemo(
    () => new PendingSparkReceiveQuotesCache(queryClient),
    [queryClient],
  );
}

/**
 * Hook that returns spark receive quote change handlers.
 */
export function useSparkReceiveQuoteChangeHandlers() {
  const pendingQuotesCache = usePendingSparkReceiveQuotesCache();
  const sparkReceiveQuoteCache = useSparkReceiveQuoteCache();
  const sparkReceiveQuoteRepository = useSparkReceiveQuoteRepository();

  return [
    {
      event: 'SPARK_RECEIVE_QUOTE_CREATED',
      handleEvent: async (payload: AgicashDbSparkReceiveQuote) => {
        const addedQuote = await sparkReceiveQuoteRepository.toQuote(payload);
        pendingQuotesCache.add(addedQuote);
      },
    },
    {
      event: 'SPARK_RECEIVE_QUOTE_UPDATED',
      handleEvent: async (payload: AgicashDbSparkReceiveQuote) => {
        const quote = await sparkReceiveQuoteRepository.toQuote(payload);

        sparkReceiveQuoteCache.updateIfExists(quote);

        const isQuoteStillPending = quote.state === 'UNPAID';
        if (isQuoteStillPending) {
          pendingQuotesCache.update(quote);
        } else {
          pendingQuotesCache.remove(quote);
        }
      },
    },
  ];
}

const usePendingSparkReceiveQuotes = () => {
  const sparkReceiveQuoteRepository = useSparkReceiveQuoteRepository();
  const userId = useUser((user) => user.id);
  const selectWithOnlineAccount = useSelectItemsWithOnlineAccount();

  const { data } = useQuery({
    queryKey: [PendingSparkReceiveQuotesCache.Key],
    queryFn: () => sparkReceiveQuoteRepository.getPending(userId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    throwOnError: true,
    select: selectWithOnlineAccount,
  });

  return data ?? [];
};

const usePendingMeltQuotes = () => {
  const pendingSparkReceiveQuotes = usePendingSparkReceiveQuotes();
  return useMemo(
    () =>
      pendingSparkReceiveQuotes
        .filter(
          (q): q is SparkReceiveQuote & { type: 'CASHU_TOKEN' } =>
            q.type === 'CASHU_TOKEN',
        )
        .map((q) => ({
          id: q.tokenReceiveData.meltQuoteId,
          mintUrl: q.tokenReceiveData.sourceMintUrl,
          currency: q.tokenReceiveData.tokenAmount.currency,
          expiryInMs: new Date(q.expiresAt).getTime(),
          inputAmount: sumProofs(q.tokenReceiveData.tokenProofs),
        })),
    [pendingSparkReceiveQuotes],
  );
};

type CreateProps = {
  /**
   * The Spark account to create the receive request for.
   */
  account: SparkAccount;
  /**
   * The amount to receive.
   */
  amount: Money;
  /**
   * Description to include in the Lightning invoice memo.
   */
  description?: string;
  /**
   * The purpose of this transaction (e.g. a Cash App buy).
   */
  purpose?: TransactionPurpose;
  /**
   * UUID linking paired send/receive transactions in a transfer.
   */
  transferId?: string;
};

/**
 * Returns a mutation for creating a Spark receive quote.
 * The quote is stored in the database and will be tracked by the background task processor.
 */
export function useCreateSparkReceiveQuote() {
  const userId = useUser((user) => user.id);
  const sparkReceiveQuoteService = useSparkReceiveQuoteService();
  const sparkReceiveQuoteCache = useSparkReceiveQuoteCache();

  return useMutation({
    scope: {
      id: 'create-spark-receive-quote',
    },
    mutationFn: async ({
      account,
      amount,
      description,
      purpose,
      transferId,
    }: CreateProps) => {
      const lightningQuote = await getLightningQuote({
        wallet: account.wallet,
        amount,
        description,
      });

      return sparkReceiveQuoteService.createReceiveQuote({
        userId,
        account,
        lightningQuote,
        receiveType: 'LIGHTNING',
        purpose,
        transferId,
      });
    },
    onSuccess: (data) => {
      sparkReceiveQuoteCache.add(data);
    },
    retry: 1,
  });
}

type OnSparkReceiveStateChangeCallbacks = {
  /**
   * Called when a quote's payment is completed.
   */
  onCompleted: (
    quoteId: string,
    paymentData: {
      paymentPreimage: string;
      sparkTransferId: string;
    },
  ) => void;
  /**
   * Called when a quote expires without being paid.
   */
  onExpired: (quoteId: string) => void;
};

export function useOnSparkReceiveStateChange({
  onCompleted,
  onExpired,
}: OnSparkReceiveStateChangeCallbacks) {
  const pendingQuotes = usePendingSparkReceiveQuotes();
  const getSparkAccount = useGetSparkAccount();

  const onCompletedRef = useLatest(onCompleted);
  const onExpiredRef = useLatest(onExpired);

  useEffect(() => {
    if (pendingQuotes.length === 0) return;

    // Group pending quotes by account for one listener per SDK instance
    const quotesByAccount = new Map<string, SparkReceiveQuote[]>();
    for (const quote of pendingQuotes) {
      const existing = quotesByAccount.get(quote.accountId);
      if (existing) {
        existing.push(quote);
      } else {
        quotesByAccount.set(quote.accountId, [quote]);
      }
    }

    const registrations: {
      wallet: SparkAccount['wallet'];
      listenerPromise: Promise<string>;
    }[] = [];

    for (const [accountId, quotes] of quotesByAccount) {
      const account = getSparkAccount(accountId);

      const quoteByPaymentHash = new Map(quotes.map((q) => [q.paymentHash, q]));

      const handlePayment = (payment: Payment) => {
        const details = payment.details;
        if (details?.type !== 'lightning') return;
        const quote = quoteByPaymentHash.get(details.htlcDetails.paymentHash);
        if (!quote) return;

        const preimage = details.htlcDetails.preimage;
        if (!preimage) {
          console.error('Receive payment succeeded but no preimage', {
            paymentId: payment.id,
            quoteId: quote.id,
          });
          return;
        }

        sparkDebugLog('Receive payment detected as completed', {
          quoteId: quote.id,
          accountId,
          sparkTransferId: payment.id,
        });
        onCompletedRef.current(quote.id, {
          sparkTransferId: payment.id,
          paymentPreimage: preimage,
        });
      };

      // Register event listener before initial check to avoid race conditions
      const listenerPromise = account.wallet.addEventListener({
        onEvent(event) {
          if (event.type === 'paymentSucceeded') {
            handlePayment(event.payment);
          } else if (event.type === 'synced') {
            for (const quote of quotes) {
              if (new Date(quote.expiresAt) < new Date()) {
                onExpiredRef.current(quote.id);
              }
            }
          }
        },
      });
      registrations.push({ wallet: account.wallet, listenerPromise });

      // Initial status check per quote using local lookup (no network call)
      for (const quote of quotes) {
        account.wallet
          .getPaymentByInvoice({ invoice: quote.paymentRequest })
          .then((response) => {
            if (response.payment && response.payment.status === 'completed') {
              handlePayment(response.payment);
            }
          })
          .catch((error) => {
            console.error('Error checking initial receive payment', {
              cause: error,
              accountId,
              quoteId: quote.id,
            });
          });
      }
    }

    return () => {
      for (const { wallet, listenerPromise } of registrations) {
        listenerPromise
          .then((id) => wallet.removeEventListener(id))
          .catch(() => {
            () => {
              console.warn('Failed to remove Spark event listener');
            };
          });
      }
    };
  }, [pendingQuotes, getSparkAccount]);
}

/**
 * Hook that processes pending spark receive quotes.
 * Polls the Spark API to check for payment status and updates quotes accordingly.
 */
export function useProcessSparkReceiveQuoteTasks() {
  const sparkReceiveQuoteService = useSparkReceiveQuoteService();
  const pendingMeltQuotes = usePendingMeltQuotes();
  const getCashuAccountByMintUrlAndCurrency =
    useGetCashuAccountByMintUrlAndCurrency();
  const pendingQuotesCache = usePendingSparkReceiveQuotesCache();
  const sparkReceiveQuoteCache = useSparkReceiveQuoteCache();
  const transactionsCache = useTransactionsCache();
  const queryClient = useQueryClient();

  const { mutate: completeReceiveQuote } = useMutation({
    mutationFn: async ({
      quoteId,
      paymentPreimage,
      sparkTransferId,
    }: {
      quoteId: string;
      paymentPreimage: string;
      sparkTransferId: string;
    }) => {
      const quote = pendingQuotesCache.get(quoteId);
      if (!quote) {
        // Quote was updated in the meantime so it's not pending anymore.
        return;
      }
      return sparkReceiveQuoteService.complete(
        quote,
        paymentPreimage,
        sparkTransferId,
      );
    },
    retry: 3,
    throwOnError: true,
    onSuccess: (updatedQuote) => {
      if (updatedQuote) {
        sparkDebugLog('Receive quote completed', {
          quoteId: updatedQuote.id,
          accountId: updatedQuote.accountId,
          transactionId: updatedQuote.transactionId,
        });
        // Updating the quote cache triggers navigation to the transaction details page.
        // Completing the quote also completes the transaction and if navigation to transaction
        // page happens before transaction updated realtime notification is processed, the
        // transaction would be stale in the cache with the DRAFT state. We are invalidating the
        // transaction cache here so that it starts refetching the transaction as soon as possible
        // without relying on realtime notification which might be delayed when reconnecting due to
        // the app being in background.
        transactionsCache.invalidateTransaction(updatedQuote.transactionId);
        sparkReceiveQuoteCache.updateIfExists(updatedQuote);
        pendingQuotesCache.remove(updatedQuote);
      }
    },
    onError: (error, { quoteId }) => {
      console.error('Complete spark receive quote error', {
        cause: error,
        receiveQuoteId: quoteId,
      });
    },
  });

  const { mutate: expireReceiveQuote } = useMutation({
    mutationFn: async (quoteId: string) => {
      const quote = pendingQuotesCache.get(quoteId);
      if (!quote) {
        // Quote was updated in the meantime so it's not pending anymore.
        return;
      }
      await sparkReceiveQuoteService.expire(quote);
    },
    retry: 3,
    throwOnError: true,
    onError: (error, quoteId) => {
      console.error('Expire spark receive quote error', {
        cause: error,
        receiveQuoteId: quoteId,
      });
    },
  });

  const { mutate: failReceiveQuote } = useMutation({
    mutationFn: async ({
      quoteId,
      reason,
    }: { quoteId: string; reason: string }) => {
      const quote = pendingQuotesCache.get(quoteId);
      if (!quote) {
        // This can happen when the quote was updated in the meantime so it's not pending anymore.
        return;
      }
      await sparkReceiveQuoteService.fail(quote, reason);
    },
    retry: 3,
    throwOnError: true,
    onError: (error, { quoteId }) => {
      console.error('Fail spark receive quote error', {
        cause: error,
        receiveQuoteId: quoteId,
      });
    },
  });

  const { mutate: initiateMelt } = useMutation({
    mutationFn: async (quoteId: string) => {
      const quote = pendingQuotesCache.get(quoteId);
      if (quote?.type !== 'CASHU_TOKEN') {
        // Quote not defined can happen when the quote was updated in the meantime so it's not pending anymore.
        // Quote type not CASHU_TOKEN should never happen.
        return;
      }

      const cashuUnit = getCashuUnit(quote.amount.currency);
      const sourceMintUrl = quote.tokenReceiveData.sourceMintUrl;
      const sourceAccount = getCashuAccountByMintUrlAndCurrency(
        sourceMintUrl,
        quote.tokenReceiveData.tokenAmount.currency,
      );

      let sourceWallet: ExtendedCashuWallet;
      if (sourceAccount) {
        sourceWallet = sourceAccount.wallet;
      } else {
        const { wallet, isOnline } = await getInitializedCashuWallet({
          queryClient,
          mintUrl: sourceMintUrl,
          currency: quote.tokenReceiveData.tokenAmount.currency,
        });
        if (!isOnline) throw new NetworkError('Source mint is offline');
        sourceWallet = wallet;
      }

      await sourceWallet.meltProofsIdempotent(
        {
          quote: quote.tokenReceiveData.meltQuoteId,
          amount: quote.amount.toNumber(cashuUnit),
        },
        quote.tokenReceiveData.tokenProofs,
        undefined,
        // See claim-cashu-token-service.ts for rationale on random outputs.
        { type: 'random' },
      );
    },
    retry: (failureCount, error) => {
      if (error instanceof MintOperationError) {
        return false;
      }
      return failureCount < 3;
    },
    onError: (error, quoteId) => {
      if (error instanceof MintOperationError) {
        console.warn('Failed to initiate melt.', {
          cause: error,
          receiveQuoteId: quoteId,
        });
        failReceiveQuote(
          {
            quoteId,
            reason: error.message,
          },
          { scope: { id: `cashu-receive-quote-${quoteId}` } },
        );
      } else {
        console.error('Initiate melt error', {
          cause: error,
          receiveQuoteId: quoteId,
        });
      }
    },
  });

  const { mutate: markMeltInitiated } = useMutation({
    mutationFn: async (quoteId: string) => {
      const quote = pendingQuotesCache.get(quoteId);
      if (quote?.type !== 'CASHU_TOKEN') {
        // Quote not defined can happen when the quote was updated in the meantime so it's not pending anymore.
        // Quote type not CASHU_TOKEN should never happen.
        return;
      }

      await sparkReceiveQuoteService.markMeltInitiated(quote);
    },
    retry: 3,
    onError: (error, quoteId) => {
      console.error('Mark melt initiated error', {
        cause: error,
        receiveQuoteId: quoteId,
      });
    },
  });

  useOnSparkReceiveStateChange({
    onCompleted: (quoteId, paymentData) => {
      completeReceiveQuote(
        {
          quoteId,
          paymentPreimage: paymentData.paymentPreimage,
          sparkTransferId: paymentData.sparkTransferId,
        },
        { scope: { id: `spark-receive-quote-${quoteId}` } },
      );
    },
    onExpired: (quoteId) => {
      expireReceiveQuote(quoteId, {
        scope: { id: `spark-receive-quote-${quoteId}` },
      });
    },
  });

  useOnMeltQuoteStateChange({
    quotes: pendingMeltQuotes,
    getWallet: (mintUrl, currency) => {
      const sourceAccount = getCashuAccountByMintUrlAndCurrency(
        mintUrl,
        currency,
      );
      return sourceAccount ? sourceAccount.wallet : getCashuWallet(mintUrl);
    },
    onUnpaid: (meltQuote) => {
      const receiveQuote = pendingQuotesCache.getByMeltQuoteId(meltQuote.quote);
      if (!receiveQuote) {
        return;
      }

      if (receiveQuote.tokenReceiveData.meltInitiated) {
        // If melt was initiated but the quote is again in the unpaid state, it means that the melt failed.
        failReceiveQuote(
          { quoteId: receiveQuote.id, reason: 'Cashu token melt failed.' },
          { scope: { id: `spark-receive-quote${receiveQuote.id}` } },
        );
      } else {
        initiateMelt(receiveQuote.id, {
          scope: { id: `spark-receive-quote${receiveQuote.id}` },
        });
      }
    },
    onPending: (meltQuote) => {
      const receiveQuote = pendingQuotesCache.getByMeltQuoteId(meltQuote.quote);
      if (!receiveQuote) {
        return;
      }

      markMeltInitiated(receiveQuote.id, {
        scope: { id: `spark-receive-quote${receiveQuote.id}` },
      });
    },
    onExpired: (meltQuote) => {
      const receiveQuote = pendingQuotesCache.getByMeltQuoteId(meltQuote.quote);
      if (!receiveQuote) {
        return;
      }

      expireReceiveQuote(receiveQuote.id, {
        scope: { id: `spark-receive-quote${receiveQuote.id}` },
      });
    },
  });
}
