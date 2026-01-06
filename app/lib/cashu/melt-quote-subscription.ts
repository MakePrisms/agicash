import { MeltQuoteState, type PartialMeltQuoteResponse } from '@cashu/cashu-ts';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { type LongTimeout, clearLongTimeout, setLongTimeout } from '../timeout';
import { useLatest } from '../use-latest';
import { MeltQuoteSubscriptionManager } from './melt-quote-subscription-manager';
import { getCashuWallet } from './utils';

type OnMeltQuoteStateChangeProps = {
  subscriptionManager?: MeltQuoteSubscriptionManager;
  quotes: {
    id: string;
    mintUrl: string;
    expiryInMs: number;
    inputAmount: number;
  }[];
  onUnpaid?: (meltQuote: PartialMeltQuoteResponse) => void;
  onPending?: (meltQuote: PartialMeltQuoteResponse) => void;
  onPaid?: (meltQuote: PartialMeltQuoteResponse) => void;
  onExpired?: (meltQuote: PartialMeltQuoteResponse) => void;
};

export function useOnMeltQuoteStateChange({
  subscriptionManager: manager,
  quotes,
  onUnpaid,
  onPending,
  onPaid,
  onExpired,
}: OnMeltQuoteStateChangeProps) {
  const [subscriptionManager] = useState(
    () => manager ?? new MeltQuoteSubscriptionManager(),
  );

  const onUnpaidRef = useLatest(onUnpaid);
  const onPendingRef = useLatest(onPending);
  const onPaidRef = useLatest(onPaid);
  const onExpiredRef = useLatest(onExpired);

  const getQuoteDataRef = useLatest((meltQuoteId: string) => {
    return quotes.find((q) => q.id === meltQuoteId);
  });

  const handleMeltQuoteUpdate = useCallback(
    async (meltQuote: PartialMeltQuoteResponse, handleExpiry = false) => {
      console.debug(`Melt quote state changed: ${meltQuote.state}`, {
        request: meltQuote.request,
        unit: meltQuote.unit,
      });

      const quoteData = getQuoteDataRef.current(meltQuote.quote);
      if (!quoteData) {
        return;
      }

      if (meltQuote.state === MeltQuoteState.UNPAID) {
        const expiresAt = new Date(quoteData.expiryInMs);
        const now = new Date();
        if (expiresAt > now) {
          onUnpaidRef.current?.(meltQuote);
        } else if (handleExpiry) {
          onExpiredRef.current?.(meltQuote);
        }
      } else if (meltQuote.state === MeltQuoteState.PENDING) {
        onPendingRef.current?.(meltQuote);
      } else if (meltQuote.state === MeltQuoteState.PAID) {
        // There is a bug in nutshell where the change is not included in the melt quote state updates, so we need to refetch the quote to get the change proofs.
        // see https://github.com/cashubtc/nutshell/pull/788
        const expectChange = quoteData.inputAmount > meltQuote.amount;
        if (
          expectChange &&
          !(meltQuote.change && meltQuote.change.length > 0)
        ) {
          const wallet = getCashuWallet(quoteData.mintUrl);
          const meltQuoteWithChange = await wallet.checkMeltQuote(quoteData.id);
          onPaidRef.current?.(meltQuoteWithChange);
        } else {
          onPaidRef.current?.(meltQuote);
        }
      }
    },
    [],
  );

  const { mutate: subscribe } = useMutation({
    mutationFn: (props: Parameters<typeof subscriptionManager.subscribe>[0]) =>
      subscriptionManager.subscribe(props),
    retry: 5,
    onError: (error, variables) => {
      console.error('Error subscribing to melt quote updates', {
        mintUrl: variables.mintUrl,
        cause: error,
      });
    },
  });

  useEffect(() => {
    if (quotes.length === 0) return;

    const quotesByMint = quotes.reduce<Record<string, string[]>>(
      (acc, quote) => {
        const existingQuotesForMint = acc[quote.mintUrl] ?? [];
        acc[quote.mintUrl] = existingQuotesForMint.concat(quote.id);
        return acc;
      },
      {},
    );

    Object.entries(quotesByMint).map(([mintUrl, quoteIds]) =>
      subscribe({ mintUrl, quoteIds, onUpdate: handleMeltQuoteUpdate }),
    );
  }, [quotes, subscribe, handleMeltQuoteUpdate]);

  useEffect(() => {
    // We need to check the state of the quote upon expiration because there is no state change for the expiration
    // so socket will not notify us.
    if (quotes.length === 0) return;

    const timeouts: LongTimeout[] = [];

    for (const quote of quotes) {
      const msUntilExpiration = quote.expiryInMs - Date.now();
      const quoteTimeout = setLongTimeout(async () => {
        try {
          const wallet = getCashuWallet(quote.mintUrl);
          const meltQuote = await wallet.checkMeltQuote(quote.id);
          return handleMeltQuoteUpdate(meltQuote, true);
        } catch (error) {
          console.error('Error checking melt quote upon expiration', {
            cause: error,
          });
        }
      }, msUntilExpiration);
      timeouts.push(quoteTimeout);
    }

    return () => {
      timeouts.forEach((timeout) => clearLongTimeout(timeout));
    };
  }, [quotes, handleMeltQuoteUpdate]);
}
