import type { FetchQueryOptions, QueryClient } from '@tanstack/query-core';
import {
  cashuSendSwapQueryKey,
  unresolvedCashuSendSwapsQueryKey,
} from '../../core/query-keys';
import type { Account } from '../accounts/account';
import type { CashuSendSwap } from './cashu-send-swap';
import type { CashuSendSwapRepository } from './cashu-send-swap-repository';

/**
 * Cache for the "active" cashu send swap. Active one is the one that user created in current browser session.
 * We want to track active send swap even after it is completed or expired which is why we can't use unresolved send swaps query.
 * Unresolved send swaps query is used for active unresolved swaps plus "background" unresolved swaps. "Background" swaps are send swaps
 * that were created in previous browser sessions.
 */
export class CashuSendSwapCache {
  static Key = 'cashu-send-swap';

  constructor(private readonly queryClient: QueryClient) {}

  add(swap: CashuSendSwap) {
    this.queryClient.setQueryData<CashuSendSwap>(
      cashuSendSwapQueryKey(swap.id),
      swap,
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: cashuSendSwapQueryKey(),
    });
  }

  updateIfExists(swap: CashuSendSwap) {
    this.queryClient.setQueryData<CashuSendSwap>(
      cashuSendSwapQueryKey(swap.id),
      (curr) => (curr && curr.version < swap.version ? swap : undefined),
    );
  }
}

export class UnresolvedCashuSendSwapsCache {
  static Key = 'unresolved-cashu-send-swaps';

  constructor(private readonly queryClient: QueryClient) {}

  add(swap: CashuSendSwap) {
    this.queryClient.setQueryData<CashuSendSwap[]>(
      unresolvedCashuSendSwapsQueryKey(),
      (curr) => [...(curr ?? []), swap],
    );
  }

  update(swap: CashuSendSwap) {
    this.queryClient.setQueryData<CashuSendSwap[]>(
      unresolvedCashuSendSwapsQueryKey(),
      (curr) =>
        curr?.map((d) =>
          d.id === swap.id && d.version < swap.version ? swap : d,
        ),
    );
  }

  remove(swap: CashuSendSwap) {
    this.queryClient.setQueryData<CashuSendSwap[]>(
      unresolvedCashuSendSwapsQueryKey(),
      (curr) => curr?.filter((d) => d.id !== swap.id),
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: unresolvedCashuSendSwapsQueryKey(),
    });
  }
}

export const cashuSendSwapQuery = ({
  swapId,
  cashuSendSwapRepository,
}: {
  swapId?: string;
  cashuSendSwapRepository: CashuSendSwapRepository;
}) =>
  ({
    queryKey: cashuSendSwapQueryKey(swapId),
    queryFn: () => {
      if (!swapId) {
        throw new Error('Swap id is required');
      }

      return cashuSendSwapRepository.get(swapId);
    },
    staleTime: Number.POSITIVE_INFINITY,
  }) satisfies FetchQueryOptions<CashuSendSwap | null, Error>;

export const unresolvedCashuSendSwapsQuery = ({
  userId,
  cashuSendSwapRepository,
  queryClient,
  getListAccountsQuery,
}: {
  userId: string;
  cashuSendSwapRepository: CashuSendSwapRepository;
  queryClient: QueryClient;
  getListAccountsQuery: () => FetchQueryOptions<Account[], Error>;
}) =>
  ({
    queryKey: unresolvedCashuSendSwapsQueryKey(),
    queryFn: async () => {
      const [swaps, accounts] = await Promise.all([
        cashuSendSwapRepository.getUnresolved(userId),
        queryClient.fetchQuery(getListAccountsQuery()),
      ]);

      const accountsById = new Map(
        accounts.map((account) => [account.id, account]),
      );

      return swaps.filter((swap) => accountsById.get(swap.accountId)?.isOnline);
    },
    staleTime: Number.POSITIVE_INFINITY,
  }) satisfies FetchQueryOptions<CashuSendSwap[], Error>;
