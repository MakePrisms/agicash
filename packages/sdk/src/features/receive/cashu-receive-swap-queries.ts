import type { FetchQueryOptions, QueryClient } from '@tanstack/query-core';
import { pendingCashuReceiveSwapsQueryKey } from '../../core/query-keys';
import type { Account } from '../accounts/account';
import type { CashuReceiveSwap } from './cashu-receive-swap';
import type { CashuReceiveSwapRepository } from './cashu-receive-swap-repository';

export class PendingCashuReceiveSwapsCache {
  static Key = 'pending-cashu-receive-swaps';

  constructor(private readonly queryClient: QueryClient) {}

  get(tokenHash: string) {
    return this.queryClient
      .getQueryData<CashuReceiveSwap[]>(pendingCashuReceiveSwapsQueryKey())
      ?.find((s) => s.tokenHash === tokenHash);
  }

  add(receiveSwap: CashuReceiveSwap) {
    this.queryClient.setQueryData<CashuReceiveSwap[]>(
      pendingCashuReceiveSwapsQueryKey(),
      (curr) => [...(curr ?? []), receiveSwap],
    );
  }

  update(receiveSwap: CashuReceiveSwap) {
    this.queryClient.setQueryData<CashuReceiveSwap[]>(
      pendingCashuReceiveSwapsQueryKey(),
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
      pendingCashuReceiveSwapsQueryKey(),
      (curr) => curr?.filter((d) => d.tokenHash !== receiveSwap.tokenHash),
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: pendingCashuReceiveSwapsQueryKey(),
    });
  }
}

export const pendingCashuReceiveSwapsQuery = ({
  userId,
  cashuReceiveSwapRepository,
  queryClient,
  getListAccountsQuery,
}: {
  userId: string;
  cashuReceiveSwapRepository: CashuReceiveSwapRepository;
  queryClient: QueryClient;
  getListAccountsQuery: () => FetchQueryOptions<Account[], Error>;
}) =>
  ({
    queryKey: pendingCashuReceiveSwapsQueryKey(),
    queryFn: async () => {
      const [swaps, accounts] = await Promise.all([
        cashuReceiveSwapRepository.getPending(userId),
        queryClient.fetchQuery(getListAccountsQuery()),
      ]);

      const accountsById = new Map(
        accounts.map((account) => [account.id, account]),
      );

      return swaps.filter((swap) => accountsById.get(swap.accountId)?.isOnline);
    },
    staleTime: Number.POSITIVE_INFINITY,
  }) satisfies FetchQueryOptions<CashuReceiveSwap[], Error>;
