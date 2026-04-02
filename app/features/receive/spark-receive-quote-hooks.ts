import type { AgicashDbSparkReceiveQuote } from '@agicash/sdk/db/database';
import type { SparkAccount } from '@agicash/sdk/features/accounts/account';
import {
  PendingSparkReceiveQuotesCache,
  SparkReceiveQuoteCache,
  sparkReceiveQuoteQuery,
} from '@agicash/sdk/features/receive/spark-receive-queries';
import type { SparkReceiveQuote } from '@agicash/sdk/features/receive/spark-receive-quote';
import type { TransactionPurpose } from '@agicash/sdk/features/transactions/transaction-enums';
import type { Money } from '@agicash/sdk/lib/money/index';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useLatest } from '~/lib/use-latest';
import { useUser } from '../user/user-hooks';
import { useWalletClient } from '../wallet/wallet-client';
import { getLightningQuote } from './spark-receive-quote-core';
import { useSparkReceiveQuoteService } from './spark-receive-quote-service';

export { PendingSparkReceiveQuotesCache, SparkReceiveQuoteCache };

export function useSparkReceiveQuoteCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new SparkReceiveQuoteCache(queryClient), [queryClient]);
}

export function usePendingSparkReceiveQuotesCache() {
  const queryClient = useQueryClient();
  return useMemo(
    () => new PendingSparkReceiveQuotesCache(queryClient),
    [queryClient],
  );
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
  const wallet = useWalletClient();

  const queryOptions = sparkReceiveQuoteQuery({
    quoteId,
    sparkReceiveQuoteRepository: wallet.repos.sparkReceiveQuoteRepo,
  });

  const { data } = useQuery({
    ...queryOptions,
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

/**
 * Hook that returns spark receive quote change handlers.
 */
export function useSparkReceiveQuoteChangeHandlers() {
  const pendingQuotesCache = usePendingSparkReceiveQuotesCache();
  const sparkReceiveQuoteCache = useSparkReceiveQuoteCache();
  const wallet = useWalletClient();

  return [
    {
      event: 'SPARK_RECEIVE_QUOTE_CREATED',
      handleEvent: async (payload: AgicashDbSparkReceiveQuote) => {
        const addedQuote =
          await wallet.repos.sparkReceiveQuoteRepo.toQuote(payload);
        pendingQuotesCache.add(addedQuote);
      },
    },
    {
      event: 'SPARK_RECEIVE_QUOTE_UPDATED',
      handleEvent: async (payload: AgicashDbSparkReceiveQuote) => {
        const quote = await wallet.repos.sparkReceiveQuoteRepo.toQuote(payload);

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
   * The Spark public key of the receiver used to create invoices on behalf of another user.
   * If not provided, the invoice will be created for the user that owns the Spark wallet.
   */
  receiverIdentityPubkey?: string;
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
      receiverIdentityPubkey,
      description,
      purpose,
      transferId,
    }: CreateProps) => {
      const lightningQuote = await getLightningQuote({
        wallet: account.wallet,
        amount,
        receiverIdentityPubkey,
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

export function useProcessSparkReceiveQuoteTasks() {
  const wallet = useWalletClient();

  useEffect(() => {
    void wallet.taskProcessors.sparkReceiveQuote.start();

    return () => {
      void wallet.taskProcessors.sparkReceiveQuote.stop();
    };
  }, [wallet]);
}
