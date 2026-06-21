import type { Money } from '@agicash/money';
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getSdk } from '~/lib/sdk';
import { useLatest } from '~/lib/use-latest';
import type { CashuAccount } from '../accounts/account';
import { useAccount } from '../accounts/account-hooks';
import { ConcurrencyError, DomainError, NotFoundError } from '../shared/error';
import type { CashuSendSwap } from './cashu-send-swap';
import { useCashuSendSwapService } from './cashu-send-swap-service';

/**
 * Query key for the "active" cashu send swap tracked by id. The send swap is
 * created in PENDING state (the token is rendered immediately), so no DRAFT wait
 * is needed. Terminal liveness comes from the SDK's core lifecycle events
 * (`send:completed`/`send:failed`) — variant B has no row events.
 */
const CashuSendSwapQueryKey = 'cashu-send-swap';

export function useCreateCashuSendSwapQuote() {
  const cashuSendSwapService = useCashuSendSwapService();

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
      return cashuSendSwapService.getQuote({
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
  return useMutation({
    mutationFn: ({
      amount,
      account,
    }: {
      amount: Money;
      account: CashuAccount;
    }) => {
      // Runs the swap synchronously and returns the PENDING swap with the encoded token.
      return getSdk().cashu.send.createTokenSend({ account, amount });
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
    onSuccess: ({ swap }) => {
      onSuccess(swap);
    },
    onError: onError,
  });
}

export function useCashuSendSwap(id: string) {
  const result = useSuspenseQuery({
    queryKey: [CashuSendSwapQueryKey, id],
    queryFn: async () => {
      const swap = await getSdk().cashu.send.getSwap(id);
      if (!swap) {
        throw new NotFoundError(`Cashu send swap not found for id: ${id}`);
      }
      return swap;
    },
    retry: (failureCount, error) => {
      if (error instanceof NotFoundError) {
        return false;
      }
      return failureCount <= 3;
    },
    staleTime: Number.POSITIVE_INFINITY,
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

/**
 * Tracks a single cashu send swap by id.
 *
 * Variant B has no row events for send swaps and terminal swaps are evicted from
 * the SDK's unresolved store, so terminal liveness is driven by the SDK's core
 * lifecycle events: a cashu send swap's terminal transition emits
 * `send:completed` (COMPLETED) / `send:failed` (FAILED, REVERSED) with
 * `payload.quoteId` set to the swap's id (see
 * `internal/realtime/lifecycle-events.ts`). On a matching event we refetch the
 * keyed query and the freshly-loaded swap drives the callbacks. `onPending` fires
 * from the query result since the swap is created in PENDING state.
 */
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

  const { data, refetch } = useQuery({
    queryKey: [CashuSendSwapQueryKey, id],
    queryFn: () => getSdk().cashu.send.getSwap(id),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    enabled,
  });

  useEffect(() => {
    if (!enabled) return;

    const sdk = getSdk();
    const refetchOnMatch = (payload: {
      protocol: 'cashu' | 'spark';
      quoteId: string;
    }) => {
      if (payload.protocol === 'cashu' && payload.quoteId === id) {
        void refetch();
      }
    };

    const offs = [
      sdk.on('send:completed', refetchOnMatch),
      sdk.on('send:failed', refetchOnMatch),
    ];

    return () => {
      for (const off of offs) {
        off();
      }
    };
  }, [enabled, id, refetch]);

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
