import type { Money } from '@agicash/money';
import type { CashuAccount, CashuSendSwap } from '@agicash/wallet-sdk';
import { SessionEndedError } from '@agicash/wallet-sdk';
import {
  CashuSendSwapRepository,
  CashuSendSwapService,
  ConcurrencyError,
  DomainError,
  NotFoundError,
} from '@agicash/wallet-sdk/temporary';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { sdk } from '~/features/shared/sdk.client';
import { useLatest } from '~/lib/use-latest';
import { useAccount, useGetCashuAccount } from '../accounts/account-hooks';
import { agicashDbClient } from '../agicash-db/database.client';
import { useCashuReceiveSwapService } from '../receive/cashu-receive-swap-hooks';
import { useEncryption } from '../shared/encryption-hooks';
import type { WalletChangeHandlers } from '../wallet/use-track-wallet-changes';

export function useCashuSendSwapRepository() {
  const encryption = useEncryption();
  return new CashuSendSwapRepository(agicashDbClient, encryption);
}

export function useCashuSendSwapService() {
  const cashuSendSwapRepository = useCashuSendSwapRepository();
  const cashuReceiveSwapService = useCashuReceiveSwapService();
  return new CashuSendSwapService(
    cashuSendSwapRepository,
    cashuReceiveSwapService,
  );
}

class CashuSendSwapCache {
  public static Key = 'cashu-send-swap';

  constructor(private readonly queryClient: QueryClient) {}

  add(swap: CashuSendSwap) {
    this.queryClient.setQueryData<CashuSendSwap>(
      [CashuSendSwapCache.Key, swap.id],
      swap,
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [CashuSendSwapCache.Key],
    });
  }

  updateIfExists(swap: CashuSendSwap) {
    this.queryClient.setQueryData<CashuSendSwap>(
      [CashuSendSwapCache.Key, swap.id],
      (curr) => (curr && curr.version < swap.version ? swap : undefined),
    );
  }
}

export function useCashuSendSwapCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new CashuSendSwapCache(queryClient), [queryClient]);
}

export function useCreateCashuSendSwapQuote() {
  return useMutation({
    mutationFn: ({
      amount,
      account,
    }: {
      amount: Money;
      account: CashuAccount;
    }) => {
      return sdk.send.cashu.getSwapQuote({
        amount,
        account,
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
  const cashuSendSwapCache = useCashuSendSwapCache();

  return useMutation({
    mutationFn: ({
      amount,
      accountId,
    }: {
      amount: Money;
      accountId: string;
    }) => {
      // Read per attempt: a ConcurrencyError retry must reselect proofs from
      // the latest cached account, not the one the first attempt saw.
      const account = getCashuAccount(accountId);
      return sdk.send.cashu
        .createSwap({
          account,
          amount,
        })
        .then(({ swap }) => swap);
    },
    retry: (failureCount, error) => {
      if (error instanceof SessionEndedError) {
        return false;
      }
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

export function useCashuSendSwap(id: string) {
  const cashuSendSwapRepository = useCashuSendSwapRepository();

  const result = useSuspenseQuery({
    queryKey: [CashuSendSwapCache.Key, id],
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
    queryKey: [CashuSendSwapCache.Key, id],
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

export function useCashuSendSwapChangeHandlers(): WalletChangeHandlers<'cashu-send-swap.updated'> {
  const cashuSendSwapCache = useCashuSendSwapCache();
  return {
    'cashu-send-swap.updated': ({ swap }) => {
      cashuSendSwapCache.updateIfExists(swap);
    },
  };
}
