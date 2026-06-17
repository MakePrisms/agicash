import type { Money } from '@agicash/utils/money';
import type { CashuAccount } from '@agicash/wallet-sdk/accounts/account';
import { ConcurrencyError, DomainError } from '@agicash/wallet-sdk/error';
import type { CashuSendSwap } from '@agicash/wallet-sdk/send/cashu-send-swap';
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLatest } from '~/lib/use-latest';
import { useAccount, useGetCashuAccount } from '../accounts/account-hooks';
import { useSdk } from '../shared/sdk';

export function useCreateCashuSendSwapQuote() {
  const sdk = useSdk();
  return useMutation({
    mutationFn: ({
      amount,
      account,
      senderPaysFee = true,
    }: {
      amount: Money;
      account: CashuAccount;
      senderPaysFee?: boolean;
    }) => {
      return sdk.send.getCashuSendSwapQuote({
        amount,
        account,
        senderPaysFee,
      });
    },
  });
}

export function useCreateCashuSendSwap({
  onSuccess,
  onError,
}: {
  onSuccess: (swap: CashuSendSwap) => void;
  onError: (error: Error) => void;
}) {
  const getCashuAccount = useGetCashuAccount();
  const sdk = useSdk();

  return useMutation({
    mutationFn: ({
      amount,
      accountId,
      senderPaysFee = true,
    }: {
      amount: Money;
      accountId: string;
      senderPaysFee?: boolean;
    }) => {
      const account = getCashuAccount(accountId);
      return sdk.send.createCashuSendSwap({
        amount,
        account,
        senderPaysFee,
      });
    },
    retry: (failureCount, error) => {
      if (error instanceof ConcurrencyError) {
        return true;
      }
      if (error instanceof DomainError) {
        return false;
      }
      return failureCount < 1;
    },
    onSuccess: (swap) => {
      onSuccess(swap);
    },
    onError: onError,
  });
}

export function useCashuSendSwap(id: string) {
  const sdk = useSdk();
  const result = useSuspenseQuery({
    ...sdk.send.cashuSwapOptions(id),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });

  const account = useAccount<'cashu'>(result.data.accountId);

  return {
    ...result,
    data: {
      ...result.data,
      account,
    },
  };
}

type UseTrackCashuSendSwapProps = {
  id?: string;
  onPending?: (swap: CashuSendSwap) => void;
  onCompleted?: (swap: CashuSendSwap) => void;
  onFailed?: (swap: CashuSendSwap) => void;
};

type UseTrackCashuSendSwapResponse =
  | {
      status: 'DISABLED' | 'LOADING';
      swap?: undefined;
    }
  | {
      status: CashuSendSwap['state'];
      swap: CashuSendSwap;
    };

export function useTrackCashuSendSwap({
  id = '',
  onPending,
  onCompleted,
  onFailed,
}: UseTrackCashuSendSwapProps): UseTrackCashuSendSwapResponse {
  const enabled = !!id;
  const onPendingRef = useLatest(onPending);
  const onCompletedRef = useLatest(onCompleted);
  const onFailedRef = useLatest(onFailed);
  const sdk = useSdk();

  const { data } = useQuery({
    ...sdk.send.trackCashuSwapOptions(id),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    enabled,
  });

  useEffect(() => {
    if (!data) return;

    if (data.state === 'PENDING') {
      onPendingRef.current?.(data);
    } else if (data.state === 'COMPLETED') {
      onCompletedRef.current?.(data);
    } else if (data.state === 'FAILED') {
      onFailedRef.current?.(data);
    }
  }, [data]);

  if (!enabled) {
    return { status: 'DISABLED' };
  }

  if (!data) {
    return { status: 'LOADING' };
  }

  return {
    status: data.state,
    swap: data,
  };
}
