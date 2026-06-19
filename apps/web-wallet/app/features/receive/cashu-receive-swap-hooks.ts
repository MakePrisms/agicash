import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { getSdk } from '~/lib/sdk';
import type { CashuReceiveSwap } from './cashu-receive-swap';

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
