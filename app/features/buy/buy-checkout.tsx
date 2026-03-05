import { AlertCircle } from 'lucide-react';
import { MoneyDisplay } from '~/components/money-display';
import {
  PageBackButton,
  PageContent,
  PageFooter,
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
import type { Account, CashuAccount, SparkAccount } from '../accounts/account';
import { useCashuReceiveQuote } from '../receive/cashu-receive-quote-hooks';
import { useSparkReceiveQuote } from '../receive/spark-receive-quote-hooks';
import { getDefaultUnit } from '../shared/currencies';
import { MoneyWithConvertedAmount } from '../shared/money-with-converted-amount';
import type { BuyQuote } from './buy-store';
import { buildCashAppDeepLink } from './cash-app';

const getErrorMessageFromQuoteStatus = (status: string) => {
  if (status === 'EXPIRED') {
    return 'This invoice has expired. Please create a new one.';
  }
  if (status === 'FAILED') {
    return 'Something went wrong. Please try again.';
  }
  return undefined;
};

const getRedirectTo = (account: Account) => {
  if (account.purpose === 'gift-card') {
    return `/gift-cards/${account.id}`;
  }
  return undefined;
};

const useNavigateToTransaction = (redirectTo?: string) => {
  const navigate = useNavigateWithViewTransition();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();

  return (transactionId: string) => {
    const params: Record<string, string> = { showOkButton: 'true' };
    if (redirectTo) {
      params.redirectTo = redirectTo;
    }
    navigate(
      buildLinkWithSearchParams(`/transactions/${transactionId}`, params),
      { transition: 'fade', applyTo: 'newView' },
    );
  };
};

const ConfirmationRow = ({
  label,
  value,
}: { label: string; value: React.ReactNode }) => {
  return (
    <div className="flex items-center justify-between">
      <p className="text-muted-foreground">{label}</p>
      <div>{value}</div>
    </div>
  );
};

function ErrorCard({ message }: { message: string }) {
  return (
    <Card className="w-full">
      <CardContent className="flex flex-col items-center justify-center gap-2 p-6">
        <AlertCircle className="h-8 w-8 text-foreground" />
        <p className="text-center text-muted-foreground text-sm">{message}</p>
      </CardContent>
    </Card>
  );
}

function ConfirmationDetails({
  accountName,
  fee,
}: { accountName: string; fee?: Money }) {
  return (
    <Card className="w-full">
      <CardContent className="flex flex-col gap-6 pt-6">
        <ConfirmationRow label="From" value="Cash App" />
        <ConfirmationRow label="To" value={accountName} />
        {fee && (
          <ConfirmationRow
            label="Fee"
            value={
              <MoneyDisplay
                size="sm"
                money={fee}
                unit={getDefaultUnit(fee.currency)}
              />
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

function MobileCheckoutContent({
  errorMessage,
  accountName,
  fee,
}: {
  errorMessage: string | undefined;
  accountName: string;
  fee?: Money;
}) {
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 mx-auto flex max-w-sm items-center justify-center">
      <div className="m-4 w-full">
        {errorMessage ? (
          <ErrorCard message={errorMessage} />
        ) : (
          <ConfirmationDetails accountName={accountName} fee={fee} />
        )}
      </div>
    </div>
  );
}

function DesktopCheckoutContent({
  errorMessage,
  paymentRequest,
  accountName,
  fee,
}: {
  errorMessage: string | undefined;
  paymentRequest: string;
  accountName: string;
  fee?: Money;
}) {
  if (errorMessage) {
    return (
      <div className="max-w-sm">
        <ErrorCard message={errorMessage} />
      </div>
    );
  }

  const deepLinkUrl = buildCashAppDeepLink(paymentRequest);

  return (
    <>
      <QRCode
        value={deepLinkUrl}
        description="Scan with Cash App"
        className="gap-4"
      />
      <div className="w-full max-w-sm">
        <ConfirmationDetails accountName={accountName} fee={fee} />
      </div>
    </>
  );
}

function CashAppCheckout({
  paymentRequest,
  amount,
  accountName,
  errorMessage,
  fee,
}: {
  paymentRequest: string;
  amount: Money;
  accountName: string;
  errorMessage: string | undefined;
  fee?: Money;
}) {
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();
  const { isMobile } = useUserAgent();
  const deepLinkUrl = buildCashAppDeepLink(paymentRequest);

  return (
    <>
      <PageHeader className="z-10">
        <PageBackButton
          to={buildLinkWithSearchParams('/buy')}
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>Buy</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center gap-4">
        <MoneyWithConvertedAmount money={amount} />
        {isMobile ? (
          <MobileCheckoutContent
            errorMessage={errorMessage}
            accountName={accountName}
            fee={fee}
          />
        ) : (
          <DesktopCheckoutContent
            errorMessage={errorMessage}
            paymentRequest={paymentRequest}
            accountName={accountName}
            fee={fee}
          />
        )}
      </PageContent>
      {isMobile && !errorMessage && (
        <PageFooter className="pb-14">
          <Button asChild className="w-[80px]">
            <a href={deepLinkUrl}>Pay</a>
          </Button>
        </PageFooter>
      )}
    </>
  );
}

export function BuyCheckoutCashu({
  quote,
  amount,
  account,
}: {
  quote: BuyQuote;
  amount: Money;
  account: CashuAccount;
}) {
  const navigateToTransaction = useNavigateToTransaction(
    getRedirectTo(account),
  );

  const { status: quotePaymentStatus } = useCashuReceiveQuote({
    quoteId: quote.id,
    onPaid: (cashuQuote) => {
      navigateToTransaction(cashuQuote.transactionId);
    },
  });

  return (
    <CashAppCheckout
      paymentRequest={quote.paymentRequest}
      amount={amount}
      accountName={account.name}
      errorMessage={getErrorMessageFromQuoteStatus(quotePaymentStatus)}
      fee={quote.mintingFee}
    />
  );
}

export function BuyCheckoutSpark({
  quote,
  amount,
  account,
}: {
  quote: BuyQuote;
  amount: Money;
  account: SparkAccount;
}) {
  const navigateToTransaction = useNavigateToTransaction(
    getRedirectTo(account),
  );

  const { status: quotePaymentStatus } = useSparkReceiveQuote({
    quoteId: quote.id,
    onPaid: (sparkQuote) => {
      navigateToTransaction(sparkQuote.transactionId);
    },
  });

  return (
    <CashAppCheckout
      paymentRequest={quote.paymentRequest}
      amount={amount}
      accountName={account.name}
      errorMessage={getErrorMessageFromQuoteStatus(quotePaymentStatus)}
    />
  );
}
