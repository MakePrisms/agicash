import type { Token } from '@cashu/cashu-ts';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import {
  type QueryClient,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useSupabaseRealtime } from '~/lib/supabase';
import { useLatest } from '~/lib/use-latest';
import { useGetLatestCashuAccount } from '../accounts/account-hooks';
import {
  type AgicashDbCashuTokenSwap,
  agicashRealtime,
} from '../agicash-db/database';
import { useEncryption } from '../shared/encryption';
import { useUser } from '../user/user-hooks';
import type { CashuTokenSwap } from './cashu-token-swap';
import {
  CashuTokenSwapRepository,
  useCashuTokenSwapRepository,
} from './cashu-token-swap-repository';
import { useCashuTokenSwapService } from './cashu-token-swap-service';

type CreateProps = {
  token: Token;
  accountId: string;
};

// Query to track the active token swap for a given token hash. The active swap is the one that user created in current browser session, and we track it in order to show the current state of the swap on the receive page.
const cashuTokenSwapQueryKey = 'cashu-token-swap';
// Query to track all pending token swaps for a given user (active and ones where recovery is being attempted).
const pendingCashuTokenSwapsQueryKey = 'pending-cashu-token-swaps';

class CashuTokenSwapCache {
  constructor(private readonly queryClient: QueryClient) {}

  get(tokenHash: string) {
    return this.queryClient.getQueryData<CashuTokenSwap>([
      cashuTokenSwapQueryKey,
      tokenHash,
    ]);
  }

  add(tokenSwap: CashuTokenSwap) {
    this.queryClient.setQueryData<CashuTokenSwap>(
      [cashuTokenSwapQueryKey, tokenSwap.tokenHash],
      tokenSwap,
    );
  }

  updateIfExists(tokenSwap: CashuTokenSwap) {
    this.queryClient.setQueryData<CashuTokenSwap>(
      [cashuTokenSwapQueryKey, tokenSwap.tokenHash],
      (curr) => (curr ? tokenSwap : undefined),
    );
  }
}

class PendingCashuTokenSwapsCache {
  constructor(private readonly queryClient: QueryClient) {}

  add(tokenSwap: CashuTokenSwap) {
    this.queryClient.setQueryData<CashuTokenSwap[]>(
      [pendingCashuTokenSwapsQueryKey],
      (curr) => [...(curr ?? []), tokenSwap],
    );
  }

  update(tokenSwap: CashuTokenSwap) {
    this.queryClient.setQueryData<CashuTokenSwap[]>(
      [pendingCashuTokenSwapsQueryKey],
      (curr) =>
        curr?.map((d) => (d.tokenHash === tokenSwap.tokenHash ? tokenSwap : d)),
    );
  }

  remove(tokenSwap: CashuTokenSwap) {
    this.queryClient.setQueryData<CashuTokenSwap[]>(
      [pendingCashuTokenSwapsQueryKey],
      (curr) => curr?.filter((d) => d.tokenHash !== tokenSwap.tokenHash),
    );
  }
}

export function useCashuTokenSwapCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new CashuTokenSwapCache(queryClient), [queryClient]);
}

export function useCreateCashuTokenSwap() {
  const userId = useUser((user) => user.id);
  const tokenSwapService = useCashuTokenSwapService();
  const tokenSwapCache = useCashuTokenSwapCache();
  const getLatestAccount = useGetLatestCashuAccount();

  return useMutation({
    mutationKey: ['create-cashu-token-swap'],
    scope: {
      id: 'create-cashu-token-swap',
    },
    mutationFn: async ({ token, accountId }: CreateProps) => {
      const account = await getLatestAccount(accountId);
      return tokenSwapService.create({
        userId,
        token,
        account,
      });
    },
    onSuccess: async ({ tokenSwap }) => {
      tokenSwapCache.add(tokenSwap);
    },
  });
}

type UseTokenSwapProps = {
  tokenHash?: string;
  onCompleted?: (swap: CashuTokenSwap) => void;
  onFailed?: (swap: CashuTokenSwap) => void;
};

type UseTokenSwapResponse =
  | {
      status: 'LOADING';
    }
  | {
      status: CashuTokenSwap['state'];
      swap: CashuTokenSwap;
    };

export function useTokenSwap({
  tokenHash,
  onCompleted,
  onFailed,
}: UseTokenSwapProps): UseTokenSwapResponse {
  const enabled = !!tokenHash;
  const onCompletedRef = useLatest(onCompleted);
  const onFailedRef = useLatest(onFailed);
  const cache = useCashuTokenSwapCache();

  const { data } = useQuery({
    queryKey: [cashuTokenSwapQueryKey, tokenHash],
    queryFn: () => cache.get(tokenHash ?? ''),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    enabled,
  });

  useEffect(() => {
    if (!data) return;

    if (data.state === 'COMPLETED') {
      onCompletedRef.current?.(data);
    } else if (data.state === 'FAILED') {
      onFailedRef.current?.(data);
    }
  }, [data]);

  if (!data) {
    return { status: 'LOADING' };
  }

  return {
    status: data.state,
    swap: data,
  };
}

function useOnCashuTokenSwapChange({
  onCreated,
  onUpdated,
}: {
  onCreated: (swap: CashuTokenSwap) => void;
  onUpdated: (swap: CashuTokenSwap) => void;
}) {
  const encryption = useEncryption();
  const queryClient = useQueryClient();

  const changeHandlerRef = useLatest(
    async (
      payload: RealtimePostgresChangesPayload<AgicashDbCashuTokenSwap>,
    ) => {
      if (payload.eventType === 'INSERT') {
        const swap = await CashuTokenSwapRepository.toTokenSwap(
          payload.new,
          encryption.decrypt,
        );
        onCreated(swap);
      } else if (payload.eventType === 'UPDATE') {
        const swap = await CashuTokenSwapRepository.toTokenSwap(
          payload.new,
          encryption.decrypt,
        );
        onUpdated(swap);
      }
    },
  );

  return useSupabaseRealtime({
    channel: agicashRealtime
      .channel('cashu-token-swaps')
      .on<AgicashDbCashuTokenSwap>(
        'postgres_changes',
        {
          event: '*',
          schema: 'wallet',
          table: 'cashu_token_swaps',
        },
        (payload) => changeHandlerRef.current(payload),
      ),
    onConnected: () => {
      // Invalidate the pending cashu token swaps query so that the swaps are re-fetched and the cache is updated.
      // This is needed to get any data that might have been updated while the re-connection was in progress.
      queryClient.invalidateQueries({
        queryKey: [pendingCashuTokenSwapsQueryKey],
      });
    },
  });
}

function usePendingCashuTokenSwaps() {
  const userId = useUser((user) => user.id);
  const tokenSwapRepository = useCashuTokenSwapRepository();

  const { data } = useQuery({
    queryKey: [pendingCashuTokenSwapsQueryKey],
    queryFn: () => tokenSwapRepository.getPending(userId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    throwOnError: true,
  });

  return data ?? [];
}

export function useTrackPendingCashuTokenSwaps() {
  const queryClient = useQueryClient();
  const pendingSwapsCache = useMemo(
    () => new PendingCashuTokenSwapsCache(queryClient),
    [queryClient],
  );
  const tokenSwapCache = useCashuTokenSwapCache();

  return useOnCashuTokenSwapChange({
    onCreated: (swap) => {
      pendingSwapsCache.add(swap);
    },
    onUpdated: (swap) => {
      tokenSwapCache.updateIfExists(swap);

      const isSwapStillPending = swap.state === 'PENDING';
      if (isSwapStillPending) {
        pendingSwapsCache.update(swap);
      } else {
        pendingSwapsCache.remove(swap);
      }
    },
  });
}

export function useProcessCashuTokenSwapTasks() {
  const pendingSwaps = usePendingCashuTokenSwaps();
  const tokenSwapService = useCashuTokenSwapService();
  const getLatestAccount = useGetLatestCashuAccount();

  const { mutate: completeSwap } = useMutation({
    mutationFn: async (tokenHash: string) => {
      const swap = pendingSwaps.find((s) => s.tokenHash === tokenHash);
      if (!swap) {
        // This means that the swap is not pending anymore so it was removed from the cache.
        // This can happen if the swap was completed or failed in the meantime.
        return;
      }

      const account = await getLatestAccount(swap.accountId);
      await tokenSwapService.completeSwap(account, swap);
    },
    retry: 3,
    throwOnError: true,
    onError: (error, swap) => {
      console.error('Error finalizing token swap', {
        cause: error,
        swap,
      });
    },
  });

  useQueries({
    queries: pendingSwaps.map((swap) => ({
      queryKey: ['complete-cashu-token-swap', swap.tokenHash],
      queryFn: () => {
        completeSwap(swap.tokenHash);
        return true;
      },
      gcTime: 0,
      staleTime: Number.POSITIVE_INFINITY,
      retry: 0,
    })),
  });
}
