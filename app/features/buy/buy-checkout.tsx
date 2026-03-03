import { Loader2 } from 'lucide-react';
import { MoneyDisplay } from '~/components/money-display';
import {
  PageBackButton,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { QRCode } from '~/components/qr-code';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
import useUserAgent from '~/hooks/use-user-agent';
import type { Money } from '~/lib/money';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import { useCashuReceiveQuote } from '../receive/cashu-receive-quote-hooks';
import type { ReceiveQuote } from '../receive/receive-store';
import { useSparkReceiveQuote } from '../receive/spark-receive-quote-hooks';
import { getDefaultUnit } from '../shared/currencies';
import { MoneyWithConvertedAmount } from '../shared/money-with-converted-amount';
import { CashAppLogo, buildCashAppDeepLink } from './cash-app';

function CashAppCheckout({
  paymentRequest,
  amount,
  errorMessage,
  fee,
}: {
  paymentRequest: string;
  amount: Money;
  errorMessage: string | undefined;
  fee?: Money;
}) {
  const { isMobile } = useUserAgent();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();

  const deepLinkUrl = buildCashAppDeepLink(paymentRequest);

  const displayAmount = fee ? amount.add(fee) : amount;

  return (
    <>
      <PageHeader>
        <PageBackButton
          to={buildLinkWithSearchParams('/buy')}
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>Buy</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center gap-4 overflow-y-auto overflow-x-hidden">
        <MoneyWithConvertedAmount money={displayAmount} />

        {isMobile ? (
          <div className="flex w-full max-w-sm flex-col items-center gap-6">
            {errorMessage && (
              <p className="text-center text-destructive text-sm">
                {errorMessage}
              </p>
            )}

            {!errorMessage && (
              <>
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Waiting for payment...</span>
                </div>

                <Button asChild size="lg" className="w-full gap-2">
                  <a href={deepLinkUrl}>
                    <CashAppLogo className="h-5" />
                    Open Cash App
                  </a>
                </Button>
              </>
            )}
          </div>
        ) : (
          <QRCode
            value={deepLinkUrl}
            description="Scan with your phone to open Cash App."
            error={errorMessage}
            onClick={() => window.open(deepLinkUrl, '_blank')}
            className="gap-4"
            size={256}
          />
        )}

        {/* TODO: this is duplicated from receive-cashu.tsx — consider extracting to a shared component */}
        {fee && (
          <Card className="w-[256px] max-w-sm">
            <CardContent className="flex flex-col px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground">Receive</p>
                <MoneyDisplay
                  size="sm"
                  money={amount}
                  unit={getDefaultUnit(amount.currency)}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground">Fee</p>
                <MoneyDisplay
                  size="sm"
                  money={fee}
                  unit={getDefaultUnit(amount.currency)}
                />
              </div>
            </CardContent>
          </Card>
        )}
      </PageContent>
    </>
  );
}

export function BuyCheckoutCashu({
  quote,
  amount,
}: {
  quote: ReceiveQuote;
  amount: Money;
}) {
  const navigate = useNavigateWithViewTransition();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();

  const { status: quotePaymentStatus } = useCashuReceiveQuote({
    quoteId: quote.id,
    onPaid: (cashuQuote) => {
      navigate(
        buildLinkWithSearchParams(`/transactions/${cashuQuote.transactionId}`, {
          showOkButton: 'true',
        }),
        { transition: 'slideLeft', applyTo: 'newView' },
      );
    },
  });

  const errorMessage =
    quotePaymentStatus === 'EXPIRED'
      ? 'This invoice has expired. Please create a new one.'
      : undefined;

  return (
    <CashAppCheckout
      paymentRequest={quote.paymentRequest}
      amount={amount}
      errorMessage={errorMessage}
      fee={quote.mintingFee}
    />
  );
}

export function BuyCheckoutSpark({
  quote,
  amount,
}: {
  quote: ReceiveQuote;
  amount: Money;
}) {
  const navigate = useNavigateWithViewTransition();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();

  const { status: quotePaymentStatus } = useSparkReceiveQuote({
    quoteId: quote.id,
    onPaid: (sparkQuote) => {
      navigate(
        buildLinkWithSearchParams(`/transactions/${sparkQuote.transactionId}`, {
          showOkButton: 'true',
        }),
        { transition: 'slideLeft', applyTo: 'newView' },
      );
    },
  });

  const errorMessage =
    quotePaymentStatus === 'EXPIRED'
      ? 'This invoice has expired. Please create a new one.'
      : undefined;

  return (
    <CashAppCheckout
      paymentRequest={quote.paymentRequest}
      amount={amount}
      errorMessage={errorMessage}
    />
  );
}
