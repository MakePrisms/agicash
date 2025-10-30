import { useState } from 'react';
import { useCopyToClipboard } from 'usehooks-ts';
import {
  ClosePageButton,
  PageContent,
  PageFooter,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { QRCode } from '~/components/qr-code';
import { Button } from '~/components/ui/button';
import type { SparkAccount } from '~/features/accounts/account';
import { useEffectNoStrictMode } from '~/hooks/use-effect-no-strict-mode';
import { useToast } from '~/hooks/use-toast';
import type { Money } from '~/lib/money';
import {
  LinkWithViewTransition,
  useNavigateWithViewTransition,
} from '~/lib/transitions';
import { MoneyWithConvertedAmount } from '../shared/money-with-converted-amount';
import {
  useCreateSparkReceiveLightningQuote,
  useSparkReceiveQuote,
} from './spark-receive-lightning-hooks';
import type { SparkReceiveQuote } from './spark-receive-lightning-service';

type SparkReceiveQuoteProps = {
  account: SparkAccount;
  amount: Money;
  onCompleted: (quote: SparkReceiveQuote) => void;
  onCopy?: (paymentRequest: string) => void;
};

function SparkReceiveQuoteItem({
  account,
  amount,
  onCompleted,
  onCopy,
}: SparkReceiveQuoteProps) {
  const {
    mutate: createQuote,
    data: createdQuote,
    status: createQuoteStatus,
    error,
  } = useCreateSparkReceiveLightningQuote();

  const { quote, status: quotePaymentStatus } = useSparkReceiveQuote({
    quoteId: createdQuote?.id,
    onCompleted,
  });

  const isFailed = quotePaymentStatus === 'FAILED';

  useEffectNoStrictMode(() => {
    if (!quote) {
      createQuote({ account, amount });
    }
  }, [quote, createQuote, amount, account]);

  return (
    <QRCode
      value={quote?.paymentRequest}
      description="Scan with any Lightning wallet."
      error={
        isFailed ? 'This invoice has failed. Please try again.' : error?.message
      }
      isLoading={['pending', 'idle'].includes(createQuoteStatus)}
      onClick={
        quote?.paymentRequest && onCopy
          ? () => onCopy(quote.paymentRequest)
          : undefined
      }
    />
  );
}

type Props = {
  amount: Money;
  account: SparkAccount;
};

export default function ReceiveSpark({ amount, account }: Props) {
  const [showOk, setShowOk] = useState(false);
  const [, copyToClipboard] = useCopyToClipboard();
  const { toast } = useToast();
  const navigate = useNavigateWithViewTransition();

  const handleCopy = (paymentRequest: string) => {
    copyToClipboard(paymentRequest);
    toast({
      title: 'Copied Lightning invoice',
      description: `${paymentRequest.slice(0, 5)}...${paymentRequest.slice(-5)}`,
      duration: 1000,
    });
    setShowOk(true);
  };

  const handleCompleted = (quote: SparkReceiveQuote) => {
    navigate(`/transactions/spark-${quote.transferId}?redirectTo=/`, {
      transition: 'fade',
      applyTo: 'newView',
    });
  };

  return (
    <>
      <PageHeader>
        <ClosePageButton
          to="/receive"
          transition="slideDown"
          applyTo="oldView"
        />
        <PageHeaderTitle>Receive Lightning</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center overflow-x-hidden overflow-y-hidden">
        <MoneyWithConvertedAmount money={amount} />
        <SparkReceiveQuoteItem
          account={account}
          amount={amount}
          onCompleted={handleCompleted}
          onCopy={handleCopy}
        />
      </PageContent>
      {showOk && (
        <PageFooter className="pb-14">
          <Button asChild className="w-[80px]">
            <LinkWithViewTransition
              to="/"
              transition="slideDown"
              applyTo="oldView"
            >
              OK
            </LinkWithViewTransition>
          </Button>
        </PageFooter>
      )}
    </>
  );
}
