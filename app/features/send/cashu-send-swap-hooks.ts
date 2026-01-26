import {
  type QueryClient,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { Money } from '~/lib/money';
import { useLatest } from '~/lib/use-latest';
import type { CashuAccount } from '../accounts/account';
import {
  useAccount,
  useGetCashuAccount,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import type {
  AgicashDbCashuProof,
  AgicashDbCashuSendSwap,
} from '../agicash-db/database';
import { ConcurrencyError, DomainError, NotFoundError } from '../shared/error';
import { useUser } from '../user/user-hooks';
import type { CashuSendSwap, PendingCashuSendSwap } from './cashu-send-swap';
import { useCashuSendSwapRepository } from './cashu-send-swap-repository';
import { useCashuSendSwapService } from './cashu-send-swap-service';
import { ProofStateSubscriptionManager } from './proof-state-subscription-manager';

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

  get(swapId: string) {
    return this.queryClient.getQueryData<CashuSendSwap>([
      CashuSendSwapCache.Key,
      swapId,
    ]);
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

function useCashuSendSwapCache() {
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
    queryKey: [UnresolvedCashuSendSwapsCache.Key],
    queryFn: () => cashuSendSwapRepository.getUnresolved(userId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    throwOnError: true,
    select: selectSendSwapsWithOnlineAccount,
  });

  return useMemo(() => {
    const draft: (CashuSendSwap & { state: 'DRAFT' })[] = [];
    const pending: PendingCashuSendSwap[] = [];

    for (const swap of data) {
      if (swap.state === 'DRAFT') {
        draft.push(swap);
      } else if (swap.state === 'PENDING') {
        pending.push(swap as PendingCashuSendSwap);
      }
    }

    return { draft, pending };
  }, [data]);
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
  const cashuSendSwapCache = useCashuSendSwapCache();

  const { data } = useQuery({
    queryKey: [CashuSendSwapCache.Key, id],
    queryFn: () => cashuSendSwapCache.get(id),
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

type OnProofStateChangeProps = {
  swaps: PendingCashuSendSwap[];
  onSpent: (swap: CashuSendSwap) => void;
};

function useOnProofStateChange({ swaps, onSpent }: OnProofStateChangeProps) {
  const [subscriptionManager] = useState(
    () => new ProofStateSubscriptionManager(),
  );
  const getCashuAccount = useGetCashuAccount();
  const onSpentRef = useLatest(onSpent);

  const { mutate: subscribe } = useMutation({
    mutationFn: (props: Parameters<typeof subscriptionManager.subscribe>[0]) =>
      subscriptionManager.subscribe(props),
    retry: 5,
    onError: (error, variables) => {
      console.error('Failed to subscribe to proof state updates', {
        cause: error,
        mintUrl: variables.mintUrl,
      });
    },
  });

  useEffect(() => {
    const swapsByMint = swaps.reduce<Record<string, PendingCashuSendSwap[]>>(
      (acc, swap) => {
        const account = getCashuAccount(swap.accountId);
        const existing = acc[account.mintUrl] ?? [];
        acc[account.mintUrl] = existing.concat(swap);
        return acc;
      },
      {},
    );

    Object.entries(swapsByMint).forEach(([mintUrl, swaps]) => {
      subscribe({
        mintUrl,
        swaps,
        onSpent: (swap) => onSpentRef.current(swap),
      });
    });
  }, [subscribe, swaps, getCashuAccount]);
}

/**
 * Hook that returns a cashu send quote change handler.
 */
export function useCashuSendSwapChangeHandlers() {
  const cashuSendSwapCache = useCashuSendSwapCache();
  const unresolvedSwapsCache = useUnresolvedCashuSendSwapsCache();
  const cashuSendSwapRepository = useCashuSendSwapRepository();

  return [
    {
      event: 'CASHU_SEND_SWAP_CREATED',
      handleEvent: async (
        payload: AgicashDbCashuSendSwap & {
          cashu_proofs: AgicashDbCashuProof[];
        },
      ) => {
        const swap = await cashuSendSwapRepository.toSwap(payload);
        unresolvedSwapsCache.add(swap);
      },
    },
    {
      event: 'CASHU_SEND_SWAP_UPDATED',
      handleEvent: async (
        payload: AgicashDbCashuSendSwap & {
          cashu_proofs: AgicashDbCashuProof[];
        },
      ) => {
        const swap = await cashuSendSwapRepository.toSwap(payload);

        cashuSendSwapCache.updateIfExists(swap);

        if (['DRAFT', 'PENDING'].includes(swap.state)) {
          unresolvedSwapsCache.update(swap);
        } else {
          unresolvedSwapsCache.remove(swap);
        }
      },
    },
  ];
}

export function useProcessCashuSendSwapTasks() {
  const { draft, pending } = useUnresolvedCashuSendSwaps();
  const cashuSendSwapService = useCashuSendSwapService();
  const getCashuAccount = useGetCashuAccount();

  const { mutate: swapForProofsToSend } = useMutation({
    mutationFn: async (swapId: string) => {
      const swap = draft.find((s) => s.id === swapId);
      if (!swap) {
        // This means that the swap is not in draft anymore so it was removed from the draft cache.
        // This can happen if the swap is now pending or it was completed, reversed or failed in the meantime.
        return;
      }

      const account = getCashuAccount(swap.accountId);
      await cashuSendSwapService.swapForProofsToSend({
        swap,
        account,
      });
    },
    retry: 3,
    throwOnError: true,
    onError: (error, swapId) => {
      console.error('Error swapping for proofs to send', {
        cause: error,
        swapId,
      });
    },
  });

  const { mutate: completeSwap } = useMutation({
    mutationFn: async (swapId: string) => {
      const swap = pending.find((s) => s.id === swapId);
      if (!swap) {
        // This means that the swap is not pending anymore so it was removed from the pending cache.
        // This can happen if the swap was completed, reversed or failed in the meantime.
        return;
      }

      await cashuSendSwapService.complete(swap);
    },
    retry: 3,
    throwOnError: true,
    onError: (error, swapId) => {
      console.error('Error completing send swap', {
        cause: error,
        swapId,
      });
    },
  });

  useOnProofStateChange({
    swaps: pending,
    onSpent: (swap) =>
      completeSwap(swap.id, { scope: { id: `send-swap-${swap.id}` } }),
  });

  useQueries({
    queries: draft.map((swap) => ({
      queryKey: ['trigger-send-swap', swap.id],
      queryFn: async () => {
        swapForProofsToSend(swap.id, { scope: { id: `send-swap-${swap.id}` } });
        return true;
      },
      gcTime: 0,
      staleTime: Number.POSITIVE_INFINITY,
      retry: 0,
    })),
  });
}
