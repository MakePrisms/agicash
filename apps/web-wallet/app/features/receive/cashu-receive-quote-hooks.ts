import type { Money } from '@agicash/money';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getSdk } from '~/lib/sdk';
import { useLatest } from '~/lib/use-latest';
import type { CashuAccount } from '../accounts/account';
import type { TransactionPurpose } from '../transactions/transaction-enums';
import type { CashuReceiveQuote } from './cashu-receive-quote';

/**
 * Query key for the "active" cashu receive quote tracked by id. Variant B has no
 * row events and terminal quotes are evicted from the SDK's pending store, so
 * terminal liveness is driven by the SDK's core lifecycle events (see
 * {@link useTrackCashuReceiveQuote}).
 */
const CashuReceiveQuoteQueryKey = 'cashu-receive-quote';

type CreateProps = {
  account: CashuAccount;
  amount: Money;
  description?: string;
  purpose?: TransactionPurpose;
  transferId?: string;
};

export function useCreateCashuReceiveQuote() {
  return useMutation({
    scope: {
      id: 'create-cashu-receive-quote',
    },
    mutationFn: async ({
      account,
      amount,
      description,
      purpose,
      transferId,
    }: CreateProps) => {
      const sdk = getSdk();
      const quote = await sdk.cashu.receive.createLightningQuote({
        account,
        amount,
        description,
      });

      // Create-only: the SDK leader mints the proofs asynchronously on payment.
      return sdk.cashu.receive.execute({
        account,
        quote,
        purpose,
        transferId,
      });
    },
    retry: 1,
  });
}

type UseTrackCashuReceiveQuoteProps = {
  quoteId?: string;
  onPaid?: (quote: CashuReceiveQuote) => void;
  onExpired?: (quote: CashuReceiveQuote) => void;
};

type UseTrackCashuReceiveQuoteResponse =
  | {
      status: 'LOADING';
      quote?: undefined;
    }
  | {
      status: CashuReceiveQuote['state'];
      quote: CashuReceiveQuote;
    };

/**
 * Tracks a single cashu receive quote by id.
 *
 * Variant B has no row events for receive quotes and terminal quotes are evicted
 * from the SDK's pending store, so terminal liveness is driven by the SDK's core
 * lifecycle events: a cashu receive quote's terminal transition emits
 * `receive:completed` (COMPLETED) / `receive:expired` (EXPIRED) with
 * `payload.protocol === 'cashu'` and `payload.quoteId` set to the quote's id (see
 * `internal/realtime/lifecycle-events.ts`). On a matching event we refetch the
 * keyed query and the freshly-loaded quote drives the `onPaid`/`onExpired`
 * callbacks. `refetchOnWindowFocus/Reconnect: 'always'` is kept as a safety net.
 */
export function useTrackCashuReceiveQuote({
  quoteId,
  onPaid,
  onExpired,
}: UseTrackCashuReceiveQuoteProps): UseTrackCashuReceiveQuoteResponse {
  const enabled = !!quoteId;
  const onPaidRef = useLatest(onPaid);
  const onExpiredRef = useLatest(onExpired);

  const { data, refetch } = useQuery({
    queryKey: [CashuReceiveQuoteQueryKey, quoteId],
    // biome-ignore lint/style/noNonNullAssertion: quoteId is guaranteed by enabled
    queryFn: () => getSdk().cashu.receive.get(quoteId!),
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
      if (payload.protocol === 'cashu' && payload.quoteId === quoteId) {
        void refetch();
      }
    };

    const offs = [
      sdk.on('receive:completed', refetchOnMatch),
      sdk.on('receive:expired', refetchOnMatch),
    ];

    return () => {
      for (const off of offs) {
        off();
      }
    };
  }, [enabled, quoteId, refetch]);

  useEffect(() => {
    if (!data) return;

    if (data.state === 'COMPLETED') {
      onPaidRef.current?.(data);
    } else if (data.state === 'EXPIRED') {
      onExpiredRef.current?.(data);
    }
  }, [data]);

  if (!data) {
    return { status: 'LOADING' };
  }

  return {
    status: data.state,
    quote: data,
  };
}
