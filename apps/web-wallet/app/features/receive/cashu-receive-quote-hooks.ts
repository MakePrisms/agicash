import type { Money } from '@agicash/money';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { getSdk } from '~/lib/sdk';
import { useLatest } from '~/lib/use-latest';
import type { CashuAccount } from '../accounts/account';
import type { TransactionPurpose } from '../transactions/transaction-enums';
import type { CashuReceiveQuote } from './cashu-receive-quote';

type CreateProps = {
  account: CashuAccount;
  amount: Money;
  description?: string;
  purpose?: TransactionPurpose;
  transferId?: string;
};
class CashuReceiveQuoteCache {
  // Query that tracks the "active" cashu receive quote. Active one is the one that user created in current browser session.
  // We want to track active quote even after it is expired and completed which is why we can't use pending quotes query.
  // Pending quotes query is used for active pending quote plus "background" pending quotes. "Background" quotes are quotes
  // that were created in previous browser sessions.
  public static Key = 'cashu-receive-quote';

  constructor(private readonly queryClient: QueryClient) {}

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [CashuReceiveQuoteCache.Key],
    });
  }

  add(quote: CashuReceiveQuote) {
    this.queryClient.setQueryData<CashuReceiveQuote>(
      [CashuReceiveQuoteCache.Key, quote.id],
      quote,
    );
  }

  updateIfExists(quote: CashuReceiveQuote) {
    this.queryClient.setQueryData<CashuReceiveQuote>(
      [CashuReceiveQuoteCache.Key, quote.id],
      (curr) => (curr && curr.version < quote.version ? quote : undefined),
    );
  }
}

export class PendingCashuReceiveQuotesCache {
  // Query that tracks all pending cashu receive quotes (active and background ones).
  public static Key = 'pending-cashu-receive-quotes';

  constructor(private readonly queryClient: QueryClient) {}

  get(quoteId: string) {
    return this.queryClient
      .getQueryData<CashuReceiveQuote[]>([PendingCashuReceiveQuotesCache.Key])
      ?.find((q) => q.id === quoteId);
  }

  add(quote: CashuReceiveQuote) {
    this.queryClient.setQueryData<CashuReceiveQuote[]>(
      [PendingCashuReceiveQuotesCache.Key],
      (curr) => [...(curr ?? []), quote],
    );
  }

  update(quote: CashuReceiveQuote) {
    this.queryClient.setQueryData<CashuReceiveQuote[]>(
      [PendingCashuReceiveQuotesCache.Key],
      (curr) =>
        curr?.map((q) =>
          q.id === quote.id && q.version < quote.version ? quote : q,
        ),
    );
  }

  remove(quote: CashuReceiveQuote) {
    this.queryClient.setQueryData<CashuReceiveQuote[]>(
      [PendingCashuReceiveQuotesCache.Key],
      (curr) => curr?.filter((q) => q.id !== quote.id),
    );
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [PendingCashuReceiveQuotesCache.Key],
    });
  }
}

export function usePendingCashuReceiveQuotesCache() {
  const queryClient = useQueryClient();
  return useMemo(
    () => new PendingCashuReceiveQuotesCache(queryClient),
    [queryClient],
  );
}

export function useCreateCashuReceiveQuote() {
  const cashuReceiveQuoteCache = useCashuReceiveQuoteCache();

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
    onSuccess: (data) => {
      cashuReceiveQuoteCache.add(data);
    },
    retry: 1,
  });
}

export function useCashuReceiveQuoteCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new CashuReceiveQuoteCache(queryClient), [queryClient]);
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

export function useTrackCashuReceiveQuote({
  quoteId,
  onPaid,
  onExpired,
}: UseTrackCashuReceiveQuoteProps): UseTrackCashuReceiveQuoteResponse {
  const enabled = !!quoteId;
  const onPaidRef = useLatest(onPaid);
  const onExpiredRef = useLatest(onExpired);

  const { data } = useQuery({
    queryKey: [CashuReceiveQuoteCache.Key, quoteId],
    // biome-ignore lint/style/noNonNullAssertion: quoteId is guaranteed by enabled
    queryFn: () => getSdk().cashu.receive.get(quoteId!),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    enabled,
  });

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

export function useWireCashuReceiveQuoteEvents() {
  const pendingQuotesCache = usePendingCashuReceiveQuotesCache();
  const cashuReceiveQuoteCache = useCashuReceiveQuoteCache();

  useEffect(() => {
    const sdk = getSdk();
    const unsubscribers = [
      sdk.on('cashu-receive-quote:created', ({ entity }) => {
        pendingQuotesCache.add(entity);
      }),
      sdk.on('cashu-receive-quote:updated', ({ entity }) => {
        cashuReceiveQuoteCache.updateIfExists(entity);

        const isQuoteStillPending = ['UNPAID', 'PAID'].includes(entity.state);
        if (isQuoteStillPending) {
          pendingQuotesCache.update(entity);
        } else {
          pendingQuotesCache.remove(entity);
        }
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [pendingQuotesCache, cashuReceiveQuoteCache]);
}
