import type { Money } from '@agicash/utils/money';
import type { CashuAccount } from '@agicash/wallet-sdk/accounts/account';
import type { CashuReceiveQuote } from '@agicash/wallet-sdk/receive/cashu-receive-quote';
import type { TransactionPurpose } from '@agicash/wallet-sdk/transactions/transaction-enums';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLatest } from '~/lib/use-latest';
import { useSdk } from '../shared/sdk';

type CreateProps = {
  account: CashuAccount;
  amount: Money;
  description?: string;
  purpose?: TransactionPurpose;
  transferId?: string;
};

export function useCreateCashuReceiveQuote() {
  const sdk = useSdk();
  return useMutation({
    scope: {
      id: 'create-cashu-receive-quote',
    },
    mutationFn: (props: CreateProps) =>
      sdk.receive.createCashuReceiveQuote(props),
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

export function useTrackCashuReceiveQuote({
  quoteId,
  onPaid,
  onExpired,
}: UseTrackCashuReceiveQuoteProps): UseTrackCashuReceiveQuoteResponse {
  const enabled = !!quoteId;
  const onPaidRef = useLatest(onPaid);
  const onExpiredRef = useLatest(onExpired);
  const sdk = useSdk();

  const { data } = useQuery({
    ...sdk.receive.cashuQuoteOptions(quoteId),
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
