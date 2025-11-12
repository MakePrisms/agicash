import type { Token } from '@cashu/cashu-ts';
import {
  type QueryClient,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useLatest } from '~/lib/use-latest';
import {
  useGetLatestCashuAccount,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import type { AgicashDbCashuTokenSwap } from '../agicash-db/database';
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
class CashuTokenSwapCache {
  // Query to track the active token swap for a given token hash. The active swap is the one that user created in current browser session, and we track it in order to show the current state of the swap on the receive page.
  public static Key = 'cashu-token-swap';

  constructor(private readonly queryClient: QueryClient) {}

  get(tokenHash: string) {
    return this.queryClient.getQueryData<CashuTokenSwap>([
      CashuTokenSwapCache.Key,
      tokenHash,
    ]);
  }

  add(tokenSwap: CashuTokenSwap) {
    this.queryClient.setQueryData<CashuTokenSwap>(
      [CashuTokenSwapCache.Key, tokenSwap.tokenHash],
      tokenSwap,
    );
  }

  updateIfExists(tokenSwap: CashuTokenSwap) {
    this.queryClient.setQueryData<CashuTokenSwap>(
      [CashuTokenSwapCache.Key, tokenSwap.tokenHash],
      (curr) =>
        curr && curr.version < tokenSwap.version ? tokenSwap : undefined,
    );
  }
}

class PendingCashuTokenSwapsCache {
  // Query to track all pending token swaps for a given user (active and ones where recovery is being attempted).
  public static Key = 'pending-cashu-token-swaps';

  constructor(private readonly queryClient: QueryClient) {}

  get(tokenHash: string) {
    return this.queryClient
      .getQueryData<CashuTokenSwap[]>([PendingCashuTokenSwapsCache.Key])
      ?.find((s) => s.tokenHash === tokenHash);
  }

  add(tokenSwap: CashuTokenSwap) {
    this.queryClient.setQueryData<CashuTokenSwap[]>(
      [PendingCashuTokenSwapsCache.Key],
      (curr) => [...(curr ?? []), tokenSwap],
    );
  }

  update(tokenSwap: CashuTokenSwap) {
    this.queryClient.setQueryData<CashuTokenSwap[]>(
      [PendingCashuTokenSwapsCache.Key],
      (curr) =>
        curr?.map((d) =>
          d.tokenHash === tokenSwap.tokenHash && d.version < tokenSwap.version
            ? tokenSwap
            : d,
        ),
    );
  }

  remove(tokenSwap: CashuTokenSwap) {
    this.queryClient.setQueryData<CashuTokenSwap[]>(
      [PendingCashuTokenSwapsCache.Key],
      (curr) => curr?.filter((d) => d.tokenHash !== tokenSwap.tokenHash),
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [PendingCashuTokenSwapsCache.Key],
    });
  }
}

export function usePendingCashuTokenSwapsCache() {
  const queryClient = useQueryClient();
  return useMemo(
    () => new PendingCashuTokenSwapsCache(queryClient),
    [queryClient],
  );
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
    onSuccess: async ({ swap }) => {
      tokenSwapCache.add(swap);
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
    queryKey: [CashuTokenSwapCache.Key, tokenHash],
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

function usePendingCashuTokenSwaps() {
  const userId = useUser((user) => user.id);
  const tokenSwapRepository = useCashuTokenSwapRepository();
  const selectReceiveSwapsWithOnlineAccount = useSelectItemsWithOnlineAccount();

  const { data } = useQuery({
    queryKey: [PendingCashuTokenSwapsCache.Key],
    queryFn: () => tokenSwapRepository.getPending(userId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    throwOnError: true,
    select: selectReceiveSwapsWithOnlineAccount,
  });

  return data ?? [];
}

/**
 * Hook that returns a cashu token swap change handler.
 */
export function useCashuTokenSwapChangeHandlers() {
  const encryption = useEncryption();
  const pendingSwapsCache = usePendingCashuTokenSwapsCache();
  const tokenSwapCache = useCashuTokenSwapCache();

  return [
    {
      event: 'CASHU_TOKEN_SWAP_CREATED',
      handleEvent: async (payload: AgicashDbCashuTokenSwap) => {
        const swap = await CashuTokenSwapRepository.toTokenSwap(
          payload,
          encryption.decrypt,
        );
        pendingSwapsCache.add(swap);
      },
    },
    {
      event: 'CASHU_TOKEN_SWAP_UPDATED',
      handleEvent: async (payload: AgicashDbCashuTokenSwap) => {
        const swap = await CashuTokenSwapRepository.toTokenSwap(
          payload,
          encryption.decrypt,
        );

        tokenSwapCache.updateIfExists(swap);

        const isSwapStillPending = swap.state === 'PENDING';
        if (isSwapStillPending) {
          pendingSwapsCache.update(swap);
        } else {
          pendingSwapsCache.remove(swap);
        }
      },
    },
  ];
}

export function useProcessCashuTokenSwapTasks() {
  const pendingSwaps = usePendingCashuTokenSwaps();
  const tokenSwapService = useCashuTokenSwapService();
  const getLatestAccount = useGetLatestCashuAccount();
  const pendingSwapsCache = usePendingCashuTokenSwapsCache();

  const { mutate: completeSwap } = useMutation({
    mutationFn: async (tokenHash: string) => {
      const swap = pendingSwapsCache.get(tokenHash);
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
        completeSwap(swap.tokenHash, {
          scope: { id: `token-swap-${swap.tokenHash}` },
        });
        return true;
      },
      gcTime: 0,
      staleTime: Number.POSITIVE_INFINITY,
      retry: 0,
    })),
  });
}
