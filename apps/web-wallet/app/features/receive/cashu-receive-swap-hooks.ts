import type { Token } from '@cashu/cashu-ts';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import {
  useGetCashuAccount,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import { getSdk } from '../shared/sdk';

type CreateProps = {
  token: Token;
  accountId: string;
};

/**
 * Transitional (sdk.receive.internal): only for the web-owned realtime wiring
 * and task processing until the background task processing moves into the SDK (the MCP phase).
 */
export function usePendingCashuReceiveSwapsCache() {
  return getSdk().receive.internal.pendingCashuReceiveSwapsCache;
}

export function useCreateCashuReceiveSwap() {
  const getCashuAccount = useGetCashuAccount();

  return useMutation({
    mutationKey: ['create-cashu-receive-swap'],
    scope: {
      id: 'create-cashu-receive-swap',
    },
    mutationFn: ({ token, accountId }: CreateProps) => {
      const account = getCashuAccount(accountId);
      return getSdk().receive.createCashuReceiveSwap({ token, account });
    },
  });
}

function usePendingCashuReceiveSwaps() {
  const selectReceiveSwapsWithOnlineAccount = useSelectItemsWithOnlineAccount();

  const { data } = useQuery({
    ...getSdk().receive.pendingCashuSwapsOptions(),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    throwOnError: true,
    select: selectReceiveSwapsWithOnlineAccount,
  });

  return data ?? [];
}

export function useProcessCashuReceiveSwapTasks() {
  const pendingSwaps = usePendingCashuReceiveSwaps();
  const receiveSwapService = getSdk().receive.internal.cashuReceiveSwapService;
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
