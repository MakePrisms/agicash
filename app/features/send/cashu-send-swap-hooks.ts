import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
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
import { useSupabaseRealtime } from '~/lib/supabase';
import { useLatest } from '~/lib/use-latest';
import {
  useAccount,
  useAccountsCache,
  useFilterOfflineAccounts,
  useGetLatestCashuAccount,
} from '../accounts/account-hooks';
import {
  type AgicashDbCashuSendSwap,
  agicashRealtime,
} from '../agicash-db/database';
import { useEncryption } from '../shared/encryption';
import { NotFoundError } from '../shared/error';
import { useUser } from '../user/user-hooks';
import type { CashuSendSwap, PendingCashuSendSwap } from './cashu-send-swap';
import {
  CashuSendSwapRepository,
  useCashuSendSwapRepository,
} from './cashu-send-swap-repository';
import { useCashuSendSwapService } from './cashu-send-swap-service';
import { ProofStateSubscriptionManager } from './proof-state-subscription-manager';

// Query that tracks the "active" cashu send swap. Active one is the one that user created in current browser session.
// We want to track active send swap even after it is completed or expired which is why we can't use unresolved send swaps query.
// Unresolved send swaps query is used for active unresolved swaps plus "background" unresolved swaps. "Background" swaps are send swaps
// that were created in previous browser sessions.
const cashuSendSwapQueryKey = 'cashu-send-swap';
// Query that tracks all unresolved cashu send swaps (active and background ones).
const unresolvedCashuSendSwapsQueryKey = 'unresolved-cashu-send-swaps';

class CashuSendSwapCache {
  constructor(private readonly queryClient: QueryClient) {}

  add(swap: CashuSendSwap) {
    this.queryClient.setQueryData<CashuSendSwap>(
      [cashuSendSwapQueryKey, swap.id],
      swap,
    );
  }

  get(swapId: string) {
    return this.queryClient.getQueryData<CashuSendSwap>([
      cashuSendSwapQueryKey,
      swapId,
    ]);
  }

  updateIfExists(swap: CashuSendSwap) {
    this.queryClient.setQueryData<CashuSendSwap>(
      [cashuSendSwapQueryKey, swap.id],
      (curr) => (curr ? swap : undefined),
    );
  }
}

class UnresolvedCashuSendSwapsCache {
  constructor(private readonly queryClient: QueryClient) {}

  add(swap: CashuSendSwap) {
    this.queryClient.setQueryData<CashuSendSwap[]>(
      [unresolvedCashuSendSwapsQueryKey],
      (curr) => [...(curr ?? []), swap],
    );
  }

  update(swap: CashuSendSwap) {
    this.queryClient.setQueryData<CashuSendSwap[]>(
      [unresolvedCashuSendSwapsQueryKey],
      (curr) => curr?.map((d) => (d.id === swap.id ? swap : d)),
    );
  }

  remove(swap: CashuSendSwap) {
    this.queryClient.setQueryData<CashuSendSwap[]>(
      [unresolvedCashuSendSwapsQueryKey],
      (curr) => curr?.filter((d) => d.id !== swap.id),
    );
  }
}

function useCashuSendSwapCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new CashuSendSwapCache(queryClient), [queryClient]);
}

export function useGetCashuSendSwapQuote() {
  const cashuSendSwapService = useCashuSendSwapService();
  const getLatestCashuAccount = useGetLatestCashuAccount();

  return useMutation({
    mutationFn: async ({
      amount,
      accountId,
      senderPaysFee = true,
    }: {
      amount: Money;
      accountId: string;
      senderPaysFee?: boolean;
    }) => {
      const account = await getLatestCashuAccount(accountId);
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
  const getLatestCashuAccount = useGetLatestCashuAccount();
  const cashuSendSwapCache = useCashuSendSwapCache();

  return useMutation({
    mutationFn: async ({
      amount,
      accountId,
      senderPaysFee = true,
    }: {
      amount: Money;
      accountId: string;
      senderPaysFee?: boolean;
    }) => {
      const account = await getLatestCashuAccount(accountId);
      return cashuSendSwapService.create({
        userId,
        amount,
        account,
        senderPaysFee,
      });
    },
    onSuccess: (swap) => {
      cashuSendSwapCache.add(swap);
      onSuccess(swap);
    },
    onError: onError,
  });
}

function useOnCashuSendSwapChange({
  onCreated,
  onUpdated,
}: {
  onCreated: (swap: CashuSendSwap) => void;
  onUpdated: (swap: CashuSendSwap) => void;
}) {
  const encryption = useEncryption();
  const queryClient = useQueryClient();

  const changeHandlerRef = useLatest(
    async (payload: RealtimePostgresChangesPayload<AgicashDbCashuSendSwap>) => {
      if (payload.eventType === 'INSERT') {
        const addedSwap = await CashuSendSwapRepository.toSwap(
          payload.new,
          encryption.decrypt,
        );
        onCreated(addedSwap);
      } else if (payload.eventType === 'UPDATE') {
        const updatedSwap = await CashuSendSwapRepository.toSwap(
          payload.new,
          encryption.decrypt,
        );
        onUpdated(updatedSwap);
      }
    },
  );

  return useSupabaseRealtime({
    channel: agicashRealtime
      .channel('cashu-send-swaps')
      .on<AgicashDbCashuSendSwap>(
        'postgres_changes',
        { event: '*', schema: 'wallet', table: 'cashu_send_swaps' },
        (payload) => changeHandlerRef.current(payload),
      ),
    onConnected: () => {
      // Invalidate the unresolved cashu send swap query so that the swaps are re-fetched and the cache is updated.
      // This is needed to get any data that might have been updated while the re-connection was in progress.
      queryClient.invalidateQueries({
        queryKey: [unresolvedCashuSendSwapsQueryKey],
      });
    },
  });
}

export function useUnresolvedCashuSendSwaps() {
  const cashuSendSwapRepository = useCashuSendSwapRepository();
  const userId = useUser((user) => user.id);
  const filterOfflineAccounts = useFilterOfflineAccounts();

  const { data = [] } = useQuery({
    queryKey: [unresolvedCashuSendSwapsQueryKey],
    queryFn: () => cashuSendSwapRepository.getUnresolved(userId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    select: filterOfflineAccounts,
  });

  return useMemo(() => {
    const draft: (CashuSendSwap & { state: 'DRAFT' })[] = [];
    const pending: PendingCashuSendSwap[] = [];

    for (const swap of data) {
      if (swap.state === 'DRAFT') {
        draft.push(swap as CashuSendSwap & { state: 'DRAFT' });
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
    queryKey: [cashuSendSwapQueryKey, id],
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
    queryKey: [cashuSendSwapQueryKey, id],
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
  const accountsCache = useAccountsCache();
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
        const account = accountsCache.get(swap.accountId);
        if (!account || account.type !== 'cashu') {
          throw new Error(`Cashu account not found for id: ${swap.accountId}`);
        }
        const existing = acc[account.mintUrl] ?? [];
        acc[account.mintUrl] = existing.concat(swap);
        return acc;
      },
      {},
    );

    Object.entries(swapsByMint).forEach(([mintUrl, swaps]) => {
      subscribe({ mintUrl, swaps, onSpent: onSpentRef.current });
    });
  }, [subscribe, swaps, accountsCache]);
}

export function useTrackUnresolvedCashuSendSwaps() {
  const cashuSendSwapCache = useCashuSendSwapCache();
  const queryClient = useQueryClient();
  const unresolvedSwapsCache = useMemo(
    () => new UnresolvedCashuSendSwapsCache(queryClient),
    [queryClient],
  );

  return useOnCashuSendSwapChange({
    onCreated: (swap) => {
      unresolvedSwapsCache.add(swap);
    },
    onUpdated: (swap) => {
      cashuSendSwapCache.updateIfExists(swap);

      if (['DRAFT', 'PENDING'].includes(swap.state)) {
        unresolvedSwapsCache.update(swap);
      } else {
        unresolvedSwapsCache.remove(swap);
      }
    },
  });
}

export function useProcessCashuSendSwapTasks() {
  const { draft, pending } = useUnresolvedCashuSendSwaps();
  const cashuSendSwapService = useCashuSendSwapService();
  const getLatestCashuAccount = useGetLatestCashuAccount();

  const { mutate: swapForProofsToSend } = useMutation({
    mutationFn: async (swapId: string) => {
      const swap = draft.find((s) => s.id === swapId);
      if (!swap) {
        // This means that the swap is not in draft anymore so it was removed from the draft cache.
        // This can happen if the swap is now pending or it was completed, reversed or failed in the meantime.
        return;
      }

      const account = await getLatestCashuAccount(swap.accountId);
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
    onSpent: (swap) => completeSwap(swap.id),
  });

  useQueries({
    queries: draft.map((swap) => ({
      queryKey: ['trigger-send-swap', swap.id],
      queryFn: async () => {
        swapForProofsToSend(swap.id);
        return true;
      },
      gcTime: 0,
      staleTime: Number.POSITIVE_INFINITY,
      retry: 0,
    })),
  });
}
