import {
  useMutation,
  useQueries,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { Money } from '~/lib/money';
import { useLatest } from '~/lib/use-latest';
import type { CashuAccount } from '../accounts/account';
import {
  useAccount,
  useGetCashuAccount,
  useSelectItemsWithOnlineAccount,
} from '../accounts/account-hooks';
import { ConcurrencyError, DomainError } from '../shared/error';
import { getSdk } from '../shared/sdk';
import type { CashuSendSwap, PendingCashuSendSwap } from './cashu-send-swap';
import { ProofStateSubscriptionManager } from './proof-state-subscription-manager';

/**
 * Transitional (sdk.send.internal): only for the web-owned realtime wiring
 * and task processing until the SDK owns them (Phase 8).
 */
export function useUnresolvedCashuSendSwapsCache() {
  return getSdk().send.internal.unresolvedCashuSendSwapsCache;
}

/**
 * Transitional (sdk.send.internal): only for the web-owned realtime wiring
 * and task processing until the SDK owns them (Phase 8).
 */
export function useCashuSendSwapCache() {
  return getSdk().send.internal.cashuSendSwapCache;
}

export function useCreateCashuSendSwapQuote() {
  return useMutation({
    mutationFn: ({
      amount,
      account,
      senderPaysFee = true,
    }: {
      amount: Money;
      account: CashuAccount;
      senderPaysFee?: boolean;
    }) => {
      return getSdk().send.getCashuSendSwapQuote({
        amount,
        account,
        senderPaysFee,
      });
    },
  });
}

export function useCreateCashuSendSwap({
  onSuccess,
  onError,
}: {
  onSuccess: (swap: CashuSendSwap) => void;
  onError: (error: Error) => void;
}) {
  const getCashuAccount = useGetCashuAccount();

  return useMutation({
    mutationFn: ({
      amount,
      accountId,
      senderPaysFee = true,
    }: {
      amount: Money;
      accountId: string;
      senderPaysFee?: boolean;
    }) => {
      const account = getCashuAccount(accountId);
      return getSdk().send.createCashuSendSwap({
        amount,
        account,
        senderPaysFee,
      });
    },
    retry: (failureCount, error) => {
      if (error instanceof ConcurrencyError) {
        return true;
      }
      if (error instanceof DomainError) {
        return false;
      }
      return failureCount < 1;
    },
    onSuccess: (swap) => {
      onSuccess(swap);
    },
    onError: onError,
  });
}

export function useUnresolvedCashuSendSwaps() {
  const selectSendSwapsWithOnlineAccount = useSelectItemsWithOnlineAccount();

  const { data = [] } = useQuery({
    ...getSdk().send.unresolvedCashuSwapsOptions(),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    throwOnError: true,
    select: selectSendSwapsWithOnlineAccount,
  });

  return useMemo(() => {
    const draft: (CashuSendSwap & { state: 'DRAFT' })[] = [];
    const pending: PendingCashuSendSwap[] = [];

    for (const swap of data) {
      if (swap.state === 'DRAFT') {
        draft.push(swap);
      } else if (swap.state === 'PENDING') {
        pending.push(swap as PendingCashuSendSwap);
      }
    }

    return { draft, pending };
  }, [data]);
}

export function useCashuSendSwap(id: string) {
  const result = useSuspenseQuery({
    ...getSdk().send.cashuSwapOptions(id),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });

  const account = useAccount<'cashu'>(result.data.accountId);

  return {
    ...result,
    data: {
      ...result.data,
      account,
    },
  };
}

type UseTrackCashuSendSwapProps = {
  id?: string;
  onPending?: (swap: CashuSendSwap) => void;
  onCompleted?: (swap: CashuSendSwap) => void;
  onFailed?: (swap: CashuSendSwap) => void;
};

type UseTrackCashuSendSwapResponse =
  | {
      status: 'DISABLED' | 'LOADING';
      swap?: undefined;
    }
  | {
      status: CashuSendSwap['state'];
      swap: CashuSendSwap;
    };

export function useTrackCashuSendSwap({
  id = '',
  onPending,
  onCompleted,
  onFailed,
}: UseTrackCashuSendSwapProps): UseTrackCashuSendSwapResponse {
  const enabled = !!id;
  const onPendingRef = useLatest(onPending);
  const onCompletedRef = useLatest(onCompleted);
  const onFailedRef = useLatest(onFailed);

  const { data } = useQuery({
    ...getSdk().send.trackCashuSwapOptions(id),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    enabled,
  });

  useEffect(() => {
    if (!data) return;

    if (data.state === 'PENDING') {
      onPendingRef.current?.(data);
    } else if (data.state === 'COMPLETED') {
      onCompletedRef.current?.(data);
    } else if (data.state === 'FAILED') {
      onFailedRef.current?.(data);
    }
  }, [data]);

  if (!enabled) {
    return { status: 'DISABLED' };
  }

  if (!data) {
    return { status: 'LOADING' };
  }

  return {
    status: data.state,
    swap: data,
  };
}

type OnProofStateChangeProps = {
  swaps: PendingCashuSendSwap[];
  onSpent: (swap: CashuSendSwap) => void;
};

function useOnProofStateChange({ swaps, onSpent }: OnProofStateChangeProps) {
  const [subscriptionManager] = useState(
    () => new ProofStateSubscriptionManager(),
  );
  const getCashuAccount = useGetCashuAccount();
  const onSpentRef = useLatest(onSpent);

  const { mutate: subscribe } = useMutation({
    mutationFn: (props: Parameters<typeof subscriptionManager.subscribe>[0]) =>
      subscriptionManager.subscribe(props),
    retry: 5,
    onError: (error, variables) => {
      console.error('Failed to subscribe to proof state updates', {
        cause: error,
        mintUrl: variables.mintUrl,
      });
    },
  });

  useEffect(() => {
    const swapsByMint = swaps.reduce<Record<string, PendingCashuSendSwap[]>>(
      (acc, swap) => {
        const account = getCashuAccount(swap.accountId);
        const existing = acc[account.mintUrl] ?? [];
        acc[account.mintUrl] = existing.concat(swap);
        return acc;
      },
      {},
    );

    Object.entries(swapsByMint).forEach(([mintUrl, swaps]) => {
      subscribe({
        mintUrl,
        swaps,
        onSpent: (swap) => onSpentRef.current(swap),
      });
    });
  }, [subscribe, swaps, getCashuAccount]);
}

/**
 * Hook that returns a cashu send quote change handler.
 *
 * Transitional (sdk.send.internal): consumed by the web-owned realtime
 * wiring until the realtime hub moves into the SDK (Phase 8).
 */
export function useCashuSendSwapChangeHandlers() {
  return getSdk().send.internal.changeHandlers.cashuSendSwap;
}

export function useProcessCashuSendSwapTasks() {
  const { draft, pending } = useUnresolvedCashuSendSwaps();
  const cashuSendSwapService = getSdk().send.internal.cashuSendSwapService;
  const getCashuAccount = useGetCashuAccount();
  const cashuSendSwapCache = useCashuSendSwapCache();

  const { mutate: swapForProofsToSend } = useMutation({
    mutationFn: async (swapId: string) => {
      const swap = draft.find((s) => s.id === swapId);
      if (!swap) {
        // This means that the swap is not in draft anymore so it was removed from the draft cache.
        // This can happen if the swap is now pending or it was completed, reversed or failed in the meantime.
        return;
      }

      const account = getCashuAccount(swap.accountId);
      await cashuSendSwapService.swapForProofsToSend({
        swap,
        account,
      });
    },
    retry: 3,
    throwOnError: true,
    onError: (error, swapId) => {
      console.error('Error swapping for proofs to send', {
        cause: error,
        swapId,
      });
    },
  });

  const { mutate: completeSwap } = useMutation({
    mutationFn: async (swapId: string) => {
      const swap = pending.find((s) => s.id === swapId);
      if (!swap) {
        // This means that the swap is not pending anymore so it was removed from the pending cache.
        // This can happen if the swap was completed, reversed or failed in the meantime.
        return;
      }

      await cashuSendSwapService.complete(swap);
    },
    retry: 3,
    throwOnError: true,
    onSuccess: () => {
      cashuSendSwapCache.invalidate();
    },
    onError: (error, swapId) => {
      console.error('Error completing send swap', {
        cause: error,
        swapId,
      });
    },
  });

  useOnProofStateChange({
    swaps: pending,
    onSpent: (swap) =>
      completeSwap(swap.id, { scope: { id: `send-swap-${swap.id}` } }),
  });

  useQueries({
    queries: draft.map((swap) => ({
      queryKey: ['trigger-send-swap', swap.id],
      queryFn: async () => {
        swapForProofsToSend(swap.id, { scope: { id: `send-swap-${swap.id}` } });
        return true;
      },
      gcTime: 0,
      staleTime: Number.POSITIVE_INFINITY,
      retry: 0,
    })),
  });
}
