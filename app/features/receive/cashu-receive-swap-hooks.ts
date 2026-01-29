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
  useGetCashuAccount,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import type { AgicashDbCashuReceiveSwap } from '../agicash-db/database';
import { useUser } from '../user/user-hooks';
import type { CashuReceiveSwap } from './cashu-receive-swap';
import { useCashuReceiveSwapRepository } from './cashu-receive-swap-repository';
import { useCashuReceiveSwapService } from './cashu-receive-swap-service';

type CreateProps = {
  token: Token;
  accountId: string;
};
class CashuReceiveSwapCache {
  // Query to track the active receive swap for a given token hash. The active swap is the one that user created in current browser session, and we track it in order to show the current state of the swap on the receive page.
  public static Key = 'cashu-receive-swap';

  constructor(private readonly queryClient: QueryClient) {}

  get(tokenHash: string) {
    return this.queryClient.getQueryData<CashuReceiveSwap>([
      CashuReceiveSwapCache.Key,
      tokenHash,
    ]);
  }

  add(receiveSwap: CashuReceiveSwap) {
    this.queryClient.setQueryData<CashuReceiveSwap>(
      [CashuReceiveSwapCache.Key, receiveSwap.tokenHash],
      receiveSwap,
    );
  }

  updateIfExists(receiveSwap: CashuReceiveSwap) {
    this.queryClient.setQueryData<CashuReceiveSwap>(
      [CashuReceiveSwapCache.Key, receiveSwap.tokenHash],
      (curr) =>
        curr && curr.version < receiveSwap.version ? receiveSwap : undefined,
    );
  }
}

class PendingCashuReceiveSwapsCache {
  // Query to track all pending receive swaps for a given user (active and ones where recovery is being attempted).
  public static Key = 'pending-cashu-receive-swaps';

  constructor(private readonly queryClient: QueryClient) {}

  get(tokenHash: string) {
    return this.queryClient
      .getQueryData<CashuReceiveSwap[]>([PendingCashuReceiveSwapsCache.Key])
      ?.find((s) => s.tokenHash === tokenHash);
  }

  add(receiveSwap: CashuReceiveSwap) {
    this.queryClient.setQueryData<CashuReceiveSwap[]>(
      [PendingCashuReceiveSwapsCache.Key],
      (curr) => [...(curr ?? []), receiveSwap],
    );
  }

  update(receiveSwap: CashuReceiveSwap) {
    this.queryClient.setQueryData<CashuReceiveSwap[]>(
      [PendingCashuReceiveSwapsCache.Key],
      (curr) =>
        curr?.map((d) =>
          d.tokenHash === receiveSwap.tokenHash &&
          d.version < receiveSwap.version
            ? receiveSwap
            : d,
        ),
    );
  }

  remove(receiveSwap: CashuReceiveSwap) {
    this.queryClient.setQueryData<CashuReceiveSwap[]>(
      [PendingCashuReceiveSwapsCache.Key],
      (curr) => curr?.filter((d) => d.tokenHash !== receiveSwap.tokenHash),
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [PendingCashuReceiveSwapsCache.Key],
    });
  }
}

export function usePendingCashuReceiveSwapsCache() {
  const queryClient = useQueryClient();
  return useMemo(
    () => new PendingCashuReceiveSwapsCache(queryClient),
    [queryClient],
  );
}

export function useCashuReceiveSwapCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new CashuReceiveSwapCache(queryClient), [queryClient]);
}

export function useCreateCashuReceiveSwap() {
  const userId = useUser((user) => user.id);
  const receiveSwapService = useCashuReceiveSwapService();
  const receiveSwapCache = useCashuReceiveSwapCache();
  const getCashuAccount = useGetCashuAccount();

  return useMutation({
    mutationKey: ['create-cashu-receive-swap'],
    scope: {
      id: 'create-cashu-receive-swap',
    },
    mutationFn: ({ token, accountId }: CreateProps) => {
      const account = getCashuAccount(accountId);
      return receiveSwapService.create({
        userId,
        token,
        account,
      });
    },
    onSuccess: ({ swap }) => {
      receiveSwapCache.add(swap);
    },
  });
}

type UseReceiveSwapProps = {
  tokenHash?: string;
  onCompleted?: (swap: CashuReceiveSwap) => void;
  onFailed?: (swap: CashuReceiveSwap) => void;
};

type UseReceiveSwapResponse =
  | {
      status: 'LOADING';
    }
  | {
      status: CashuReceiveSwap['state'];
      swap: CashuReceiveSwap;
    };

export function useReceiveSwap({
  tokenHash,
  onCompleted,
  onFailed,
}: UseReceiveSwapProps): UseReceiveSwapResponse {
  const enabled = !!tokenHash;
  const onCompletedRef = useLatest(onCompleted);
  const onFailedRef = useLatest(onFailed);
  const cache = useCashuReceiveSwapCache();

  const { data } = useQuery({
    queryKey: [CashuReceiveSwapCache.Key, tokenHash],
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

function usePendingCashuReceiveSwaps() {
  const userId = useUser((user) => user.id);
  const receiveSwapRepository = useCashuReceiveSwapRepository();
  const selectReceiveSwapsWithOnlineAccount = useSelectItemsWithOnlineAccount();

  const { data } = useQuery({
    queryKey: [PendingCashuReceiveSwapsCache.Key],
    queryFn: () => receiveSwapRepository.getPending(userId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    throwOnError: true,
    select: selectReceiveSwapsWithOnlineAccount,
  });

  return data ?? [];
}

/**
 * Hook that returns a cashu receive swap change handler.
 */
export function useCashuReceiveSwapChangeHandlers() {
  const pendingSwapsCache = usePendingCashuReceiveSwapsCache();
  const receiveSwapCache = useCashuReceiveSwapCache();
  const cashuReceiveSwapRepository = useCashuReceiveSwapRepository();

  return [
    {
      event: 'CASHU_RECEIVE_SWAP_CREATED',
      handleEvent: async (payload: AgicashDbCashuReceiveSwap) => {
        const swap = await cashuReceiveSwapRepository.toReceiveSwap(payload);
        pendingSwapsCache.add(swap);
      },
    },
    {
      event: 'CASHU_RECEIVE_SWAP_UPDATED',
      handleEvent: async (payload: AgicashDbCashuReceiveSwap) => {
        const swap = await cashuReceiveSwapRepository.toReceiveSwap(payload);

        receiveSwapCache.updateIfExists(swap);

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

export function useProcessCashuReceiveSwapTasks() {
  const pendingSwaps = usePendingCashuReceiveSwaps();
  const receiveSwapService = useCashuReceiveSwapService();
  const getCashuAccount = useGetCashuAccount();
  const pendingSwapsCache = usePendingCashuReceiveSwapsCache();

  const { mutate: completeSwap } = useMutation({
    mutationFn: async (tokenHash: string) => {
      const swap = pendingSwapsCache.get(tokenHash);
      if (!swap) {
        // This means that the swap is not pending anymore so it was removed from the cache.
        // This can happen if the swap was completed or failed in the meantime.
        return;
      }

      const account = getCashuAccount(swap.accountId);
      await receiveSwapService.completeSwap(account, swap);
    },
    retry: 3,
    throwOnError: true,
    onError: (error, tokenHash) => {
      console.error('Error finalizing receive swap', {
        cause: error,
        tokenHash,
      });
    },
  });

  useQueries({
    queries: pendingSwaps.map((swap) => ({
      queryKey: ['complete-cashu-receive-swap', swap.tokenHash],
      queryFn: () => {
        completeSwap(swap.tokenHash, {
          scope: { id: `receive-swap-${swap.tokenHash}` },
        });
        return true;
      },
      gcTime: 0,
      staleTime: Number.POSITIVE_INFINITY,
      retry: 0,
    })),
  });
}
