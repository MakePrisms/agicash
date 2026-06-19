import type { Token } from '@cashu/cashu-ts';
import {
  type QueryClient,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { getSdk } from '~/lib/sdk';
import {
  useGetCashuAccount,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import { useUser } from '../user/user-hooks';
import type { CashuReceiveSwap } from './cashu-receive-swap';
import { useCashuReceiveSwapRepository } from './cashu-receive-swap-repository';
import { useCashuReceiveSwapService } from './cashu-receive-swap-service';

type CreateProps = {
  token: Token;
  accountId: string;
};
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

export function useCreateCashuReceiveSwap() {
  const userId = useUser((user) => user.id);
  const receiveSwapService = useCashuReceiveSwapService();
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
  });
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

export function useWireCashuReceiveSwapEvents() {
  const pendingSwapsCache = usePendingCashuReceiveSwapsCache();

  useEffect(() => {
    const sdk = getSdk();
    const unsubscribers = [
      sdk.on('cashu-receive-swap:created', ({ entity }) => {
        pendingSwapsCache.add(entity);
      }),
      sdk.on('cashu-receive-swap:updated', ({ entity }) => {
        const isSwapStillPending = entity.state === 'PENDING';
        if (isSwapStillPending) {
          pendingSwapsCache.update(entity);
        } else {
          pendingSwapsCache.remove(entity);
        }
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [pendingSwapsCache]);
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
