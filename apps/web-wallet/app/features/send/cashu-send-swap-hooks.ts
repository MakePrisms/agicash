import type { Money } from '@agicash/money';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { getSdk } from '~/lib/sdk';
import { useLatest } from '~/lib/use-latest';
import type { CashuAccount } from '../accounts/account';
import { useAccount } from '../accounts/account-hooks';
import { ConcurrencyError, DomainError, NotFoundError } from '../shared/error';
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

class UnresolvedCashuSendSwapsCache {
  // Query that tracks all unresolved cashu send swaps (active and background ones).
  public static Key = 'unresolved-cashu-send-swaps';

  constructor(private readonly queryClient: QueryClient) {}

  add(swap: CashuSendSwap) {
    this.queryClient.setQueryData<CashuSendSwap[]>(
      [UnresolvedCashuSendSwapsCache.Key],
      (curr) => [...(curr ?? []), swap],
    );
  }

  update(swap: CashuSendSwap) {
    this.queryClient.setQueryData<CashuSendSwap[]>(
      [UnresolvedCashuSendSwapsCache.Key],
      (curr) =>
        curr?.map((d) =>
          d.id === swap.id && d.version < swap.version ? swap : d,
        ),
    );
  }

  remove(swap: CashuSendSwap) {
    this.queryClient.setQueryData<CashuSendSwap[]>(
      [UnresolvedCashuSendSwapsCache.Key],
      (curr) => curr?.filter((d) => d.id !== swap.id),
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [UnresolvedCashuSendSwapsCache.Key],
    });
  }
}

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
  const cashuSendSwapCache = useCashuSendSwapCache();

  return useMutation({
    mutationFn: ({
      amount,
      account,
    }: {
      amount: Money;
      account: CashuAccount;
    }) => {
      // Runs the swap synchronously and returns the PENDING swap with the encoded token.
      return getSdk().cashu.send.createTokenSend({ account, amount });
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
    onSuccess: ({ swap }) => {
      cashuSendSwapCache.add(swap);
      onSuccess(swap);
    },
    onError: onError,
  });
}

export function useCashuSendSwap(id: string) {
  const result = useSuspenseQuery({
    queryKey: [CashuSendSwapCache.Key, id],
    queryFn: async () => {
      const swap = await getSdk().cashu.send.getSwap(id);
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

  const { data } = useQuery({
    queryKey: [CashuSendSwapCache.Key, id],
    queryFn: () => getSdk().cashu.send.getSwap(id),
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

export function useWireCashuSendSwapEvents() {
  const cashuSendSwapCache = useCashuSendSwapCache();
  const unresolvedSwapsCache = useUnresolvedCashuSendSwapsCache();

  useEffect(() => {
    const sdk = getSdk();
    const unsubscribers = [
      sdk.on('cashu-send-swap:created', ({ entity }) => {
        unresolvedSwapsCache.add(entity);
      }),
      sdk.on('cashu-send-swap:updated', ({ entity }) => {
        cashuSendSwapCache.updateIfExists(entity);

        if (['DRAFT', 'PENDING'].includes(entity.state)) {
          unresolvedSwapsCache.update(entity);
        } else {
          unresolvedSwapsCache.remove(entity);
        }
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [cashuSendSwapCache, unresolvedSwapsCache]);
}
