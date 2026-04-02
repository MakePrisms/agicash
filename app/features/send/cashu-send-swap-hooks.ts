import {
  cashuSendSwapQueryKey,
  unresolvedCashuSendSwapsQueryKey,
} from '@agicash/sdk/core/query-keys';
import type { CashuAccount } from '@agicash/sdk/features/accounts/account';
import type { CashuSendSwap } from '@agicash/sdk/features/send/cashu-send-swap';
import {
  CashuSendSwapCache,
  UnresolvedCashuSendSwapsCache,
} from '@agicash/sdk/features/send/cashu-send-swap-queries';
import {
  ConcurrencyError,
  DomainError,
  NotFoundError,
} from '@agicash/sdk/features/shared/error';
import type { Money } from '@agicash/sdk/lib/money/index';
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useLatest } from '~/lib/use-latest';
import {
  useAccount,
  useGetCashuAccount,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import { useUser } from '../user/user-hooks';
import { useWalletClient } from '../wallet/wallet-client';
import { useCashuSendSwapRepository } from './cashu-send-swap-repository';
import { useCashuSendSwapService } from './cashu-send-swap-service';

export { CashuSendSwapCache, UnresolvedCashuSendSwapsCache };

export function useUnresolvedCashuSendSwapsCache() {
  const queryClient = useQueryClient();
  return useMemo(
    () => new UnresolvedCashuSendSwapsCache(queryClient),
    [queryClient],
  );
}

export function useCashuSendSwapCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new CashuSendSwapCache(queryClient), [queryClient]);
}

export function useCreateCashuSendSwapQuote() {
  const cashuSendSwapService = useCashuSendSwapService();

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
      return cashuSendSwapService.getQuote({
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
  const cashuSendSwapService = useCashuSendSwapService();
  const userId = useUser((user) => user.id);
  const getCashuAccount = useGetCashuAccount();
  const cashuSendSwapCache = useCashuSendSwapCache();

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
      return cashuSendSwapService.create({
        userId,
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
      cashuSendSwapCache.add(swap);
      onSuccess(swap);
    },
    onError: onError,
  });
}

export function useUnresolvedCashuSendSwaps() {
  const cashuSendSwapRepository = useCashuSendSwapRepository();
  const userId = useUser((user) => user.id);
  const selectSendSwapsWithOnlineAccount = useSelectItemsWithOnlineAccount();

  const { data = [] } = useQuery({
    queryKey: unresolvedCashuSendSwapsQueryKey(),
    queryFn: () => cashuSendSwapRepository.getUnresolved(userId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    throwOnError: true,
    select: selectSendSwapsWithOnlineAccount,
  });

  return useMemo(() => {
    const draft: (CashuSendSwap & { state: 'DRAFT' })[] = [];
    const pending: (CashuSendSwap & { state: 'PENDING' })[] = [];

    for (const swap of data) {
      if (swap.state === 'DRAFT') {
        draft.push(swap);
      } else if (swap.state === 'PENDING') {
        pending.push(swap as CashuSendSwap & { state: 'PENDING' });
      }
    }

    return { draft, pending };
  }, [data]);
}

export function useCashuSendSwap(id: string) {
  const cashuSendSwapRepository = useCashuSendSwapRepository();

  const result = useSuspenseQuery({
    queryKey: cashuSendSwapQueryKey(id),
    queryFn: async () => {
      const swap = await cashuSendSwapRepository.get(id);
      if (!swap) {
        throw new NotFoundError(`Cashu send swap not found for id: ${id}`);
      }
      return swap;
    },
    retry: (failureCount, error) => {
      if (error instanceof NotFoundError) {
        return false;
      }
      return failureCount <= 3;
    },
    staleTime: Number.POSITIVE_INFINITY,
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
  const cashuSendSwapRepository = useCashuSendSwapRepository();

  const { data } = useQuery({
    queryKey: cashuSendSwapQueryKey(id),
    queryFn: () => cashuSendSwapRepository.get(id),
    staleTime: Number.POSITIVE_INFINITY,
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

export function useProcessCashuSendSwapTasks() {
  const wallet = useWalletClient();
  useEffect(() => {
    void wallet.taskProcessors.cashuSendSwap.start();
    return () => {
      void wallet.taskProcessors.cashuSendSwap.stop();
    };
  }, [wallet]);
}
