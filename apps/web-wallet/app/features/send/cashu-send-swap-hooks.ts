import type { Money } from '@agicash/money';
import type {
  CashuSendQuote as SdkCashuSendQuote,
  CashuSendSwap as SdkCashuSendSwap,
} from '@agicash/wallet-sdk';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useLatest } from '~/lib/use-latest';
import type { CashuAccount } from '../accounts/account';
import { useAccount, useGetCashuAccount } from '../accounts/account-hooks';
import { ConcurrencyError, DomainError, NotFoundError } from '../shared/error';
import { useSdk } from '../shared/use-sdk';
import { useUser } from '../user/user-hooks';
import type { CashuSendSwap } from './cashu-send-swap';
import { useCashuSendSwapService } from './cashu-send-swap-service';

class CashuSendSwapCache {
  // Query that tracks the "active" cashu send swap. Active one is the one that user created in current browser session.
  // We want to track active send swap even after it is completed or expired which is why we can't use unresolved send swaps query.
  // Unresolved send swaps query is used for active unresolved swaps plus "background" unresolved swaps. "Background" swaps are send swaps
  // that were created in previous browser sessions.
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

/**
 * Narrow `sdk.cashu.send.get` (CashuSendQuote | CashuSendSwap | null) to the
 * send-swap. A send quote carries `paymentRequest`; a send swap does not.
 */
const asSendSwap = (
  result: SdkCashuSendQuote | SdkCashuSendSwap | null,
): CashuSendSwap | null => {
  if (!result || 'paymentRequest' in result) {
    return null;
  }
  return result;
};

export function useCashuSendSwap(id: string) {
  const sdkPromise = useSdk();

  const result = useSuspenseQuery({
    queryKey: [CashuSendSwapCache.Key, id],
    queryFn: async () => {
      const sdk = await sdkPromise;
      const swap = asSendSwap(await sdk.cashu.send.get(id));
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
  const sdkPromise = useSdk();

  const { data } = useQuery({
    queryKey: [CashuSendSwapCache.Key, id],
    queryFn: async () => {
      const sdk = await sdkPromise;
      return asSendSwap(await sdk.cashu.send.get(id));
    },
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
