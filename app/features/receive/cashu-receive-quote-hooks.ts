import type { CashuAccount } from '@agicash/sdk/features/accounts/account';
import {
  CashuReceiveQuoteCache,
  PendingCashuReceiveQuotesCache,
} from '@agicash/sdk/features/receive/cashu-receive-queries';
import type { CashuReceiveQuote } from '@agicash/sdk/features/receive/cashu-receive-quote';
import type { TransactionPurpose } from '@agicash/sdk/features/transactions/transaction-enums';
import type { Money } from '@agicash/sdk/lib/money/index';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useLatest } from '~/lib/use-latest';
import { useUser } from '../user/user-hooks';
import { useWalletClient } from '../wallet/wallet-client';

type CreateProps = {
  account: CashuAccount;
  amount: Money;
  description?: string;
  purpose?: TransactionPurpose;
  transferId?: string;
};

export function usePendingCashuReceiveQuotesCache() {
  const queryClient = useQueryClient();
  return useMemo(
    () => new PendingCashuReceiveQuotesCache(queryClient),
    [queryClient],
  );
}

export function useCreateCashuReceiveQuote() {
  const userId = useUser((user) => user.id);
  const wallet = useWalletClient();
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
      const lightningQuote =
        await wallet.services.cashuReceiveQuoteService.getLightningQuote({
          wallet: account.wallet,
          amount,
          description,
        });

      return wallet.services.cashuReceiveQuoteService.createReceiveQuote({
        userId,
        account,
        receiveType: 'LIGHTNING',
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

type UseCashuReceiveQuoteProps = {
  quoteId?: string;
  onPaid?: (quote: CashuReceiveQuote) => void;
  onExpired?: (quote: CashuReceiveQuote) => void;
};

type UseCashuReceiveQuoteResponse =
  | {
      status: 'LOADING';
      quote?: undefined;
    }
  | {
      status: CashuReceiveQuote['state'];
      quote: CashuReceiveQuote;
    };

export function useCashuReceiveQuote({
  quoteId,
  onPaid,
  onExpired,
}: UseCashuReceiveQuoteProps): UseCashuReceiveQuoteResponse {
  const enabled = !!quoteId;
  const onPaidRef = useLatest(onPaid);
  const onExpiredRef = useLatest(onExpired);
  const wallet = useWalletClient();

  const { data } = useQuery({
    ...wallet.queries.cashuReceiveQuoteQuery(quoteId),
    enabled,
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: 'always',
  });

  useEffect(() => {
    if (!data) {
      return;
    }

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

export function useProcessCashuReceiveQuoteTasks() {
  const wallet = useWalletClient();

  useEffect(() => {
    void wallet.taskProcessors.cashuReceiveQuote.start();

    return () => {
      void wallet.taskProcessors.cashuReceiveQuote.stop();
    };
  }, [wallet]);
}
