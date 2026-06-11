import type { AgicashDbCashuReceiveSwap } from '@agicash/db-types';
import type { QueryClient } from '@tanstack/query-core';
import type { CashuReceiveSwap } from './cashu-receive-swap';
import type { CashuReceiveSwapRepository } from './cashu-receive-swap-repository';

export class PendingCashuReceiveSwapsCache {
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

export function createCashuReceiveSwapChangeHandlers(
  cashuReceiveSwapRepository: CashuReceiveSwapRepository,
  pendingSwapsCache: PendingCashuReceiveSwapsCache,
) {
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
