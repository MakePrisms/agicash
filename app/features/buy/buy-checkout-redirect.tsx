import { useEffect, useRef } from 'react';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import { CashAppCheckout } from './buy-checkout';
import {
  type PendingCashAppBuy,
  clearPendingCashAppBuy,
} from './pending-cashapp-buy';
import { useBuyQuoteStatus } from './use-buy-quote-status';

export function BuyCheckoutRedirect({ data }: { data: PendingCashAppBuy }) {
  const navigate = useNavigateWithViewTransition();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();
  const hasNavigated = useRef(false);

  const { state } = useBuyQuoteStatus({
    quoteId: data.quoteId,
    quoteType: data.accountType,
    onSuccess: (transactionId) => {
      if (hasNavigated.current) return;
      hasNavigated.current = true;
      clearPendingCashAppBuy();
      navigate(
        buildLinkWithSearchParams(`/transactions/${transactionId}`, {
          showOkButton: 'true',
        }),
        { transition: 'slideLeft', applyTo: 'newView' },
      );
    },
  });

  useEffect(() => {
    if (state === 'EXPIRED' || state === 'FAILED') {
      clearPendingCashAppBuy();
    }
  }, [state]);

  const errorMessage =
    state === 'EXPIRED'
      ? 'This invoice has expired. Please create a new one.'
      : state === 'FAILED'
        ? 'Payment failed. Please try again.'
        : undefined;

  return (
    <CashAppCheckout
      paymentRequest={data.paymentRequest}
      amount={data.amount}
      errorMessage={errorMessage}
      fee={data.mintingFee}
    />
  );
}
