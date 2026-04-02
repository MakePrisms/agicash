import type { CashuAccount } from '@agicash/sdk/features/accounts/account';
import type { CashuSendQuote } from '@agicash/sdk/features/send/cashu-send-quote';
import type { DestinationDetails } from '@agicash/sdk/features/send/cashu-send-quote';
import { UnresolvedCashuSendQuotesCache } from '@agicash/sdk/features/send/cashu-send-quote-queries';
import {
  ConcurrencyError,
  DomainError,
} from '@agicash/sdk/features/shared/error';
import type { Money } from '@agicash/sdk/lib/money/index';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type Big from 'big.js';
import { useEffect, useMemo } from 'react';
import { useGetCashuAccount } from '../accounts/account-hooks';
import { useUser } from '../user/user-hooks';
import { useWalletClient } from '../wallet/wallet-client';
import {
  type SendQuoteRequest,
  useCashuSendQuoteService,
} from './cashu-send-quote-service';

export function useUnresolvedCashuSendQuotesCache() {
  const queryClient = useQueryClient();
  return useMemo(
    () => new UnresolvedCashuSendQuotesCache(queryClient),
    [queryClient],
  );
}

export function useCreateCashuLightningSendQuote() {
  const cashuSendQuoteService = useCashuSendQuoteService();

  return useMutation({
    scope: {
      id: 'create-cashu-lightning-send-quote',
    },
    mutationFn: ({
      account,
      amount,
      paymentRequest,
      exchangeRate,
    }: {
      account: CashuAccount;
      paymentRequest: string;
      amount?: Money;
      exchangeRate?: Big;
    }) =>
      cashuSendQuoteService.getLightningQuote({
        account,
        amount,
        paymentRequest,
        exchangeRate,
      }),
    retry: (failureCount, error) => {
      if (error instanceof DomainError) {
        return false;
      }
      return failureCount < 1;
    },
  });
}

export function useInitiateCashuSendQuote({
  onSuccess,
  onError,
}: {
  onSuccess: (data: CashuSendQuote) => void;
  onError: (error: Error) => void;
}) {
  const userId = useUser((user) => user.id);
  const cashuSendQuoteService = useCashuSendQuoteService();
  const getCashuAccount = useGetCashuAccount();

  return useMutation({
    mutationKey: ['initiate-cashu-send-quote'],
    scope: {
      id: 'initiate-cashu-send-quote',
    },
    mutationFn: ({
      accountId,
      sendQuote,
      destinationDetails,
    }: {
      accountId: string;
      sendQuote: SendQuoteRequest;
      destinationDetails?: DestinationDetails;
    }) => {
      const account = getCashuAccount(accountId);
      return cashuSendQuoteService.createSendQuote({
        userId,
        account,
        sendQuote,
        destinationDetails,
      });
    },
    onSuccess: (data) => {
      onSuccess(data);
    },
    onError: onError,
    retry: (failureCount, error) => {
      if (error instanceof ConcurrencyError) {
        return true;
      }
      if (error instanceof DomainError) {
        return false;
      }
      return failureCount < 1;
    },
  });
}

export function useProcessCashuSendQuoteTasks() {
  const wallet = useWalletClient();
  useEffect(() => {
    void wallet.taskProcessors.cashuSendQuote.start();
    return () => {
      void wallet.taskProcessors.cashuSendQuote.stop();
    };
  }, [wallet]);
}
