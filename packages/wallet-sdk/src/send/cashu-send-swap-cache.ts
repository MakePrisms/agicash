import type {
  AgicashDbCashuProof,
  AgicashDbCashuSendSwap,
} from '@agicash/db-types';
import type { QueryClient } from '@tanstack/query-core';
import type { CashuSendSwap } from './cashu-send-swap';
import type { CashuSendSwapRepository } from './cashu-send-swap-repository';

export class CashuSendSwapCache {
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

export class UnresolvedCashuSendSwapsCache {
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

export function createCashuSendSwapChangeHandlers(
  cashuSendSwapRepository: CashuSendSwapRepository,
  cashuSendSwapCache: CashuSendSwapCache,
  unresolvedSwapsCache: UnresolvedCashuSendSwapsCache,
) {
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
