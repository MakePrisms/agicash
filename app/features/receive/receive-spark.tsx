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
import { useEffectNoStrictMode } from '~/hooks/use-effect-no-strict-mode';
import { useToast } from '~/hooks/use-toast';
import type { Money } from '~/lib/money';
import {
  LinkWithViewTransition,
  useNavigateWithViewTransition,
} from '~/lib/transitions';
import type { SparkAccount } from '../accounts/account';
import { MoneyWithConvertedAmount } from '../shared/money-with-converted-amount';
import type { SparkReceiveQuote } from './spark-receive-quote';
import {
  useCreateSparkReceiveQuote,
  useSparkReceiveQuote,
} from './spark-receive-quote-hooks';

type Props = {
  amount: Money;
  account: SparkAccount;
};

const useCreateQuote = ({
  account,
  amount,
  onPaid,
}: {
  account: SparkAccount;
  amount: Money;
  onPaid: (quote: SparkReceiveQuote) => void;
}) => {
  const {
    mutate: createQuote,
    data: createdQuote,
    status: createQuoteStatus,
    error,
  } = useCreateSparkReceiveQuote();

  const { quote, status: quotePaymentStatus } = useSparkReceiveQuote({
    quoteId: createdQuote?.id,
    onPaid,
  });

  const isExpired = quotePaymentStatus === 'EXPIRED';

  useEffectNoStrictMode(() => {
    if (!quote && createQuoteStatus === 'idle') {
      createQuote({ account, amount });
    }
  }, [quote, createQuoteStatus, createQuote, amount, account]);

  return {
    quote,
    errorMessage: isExpired
      ? 'This invoice has expired. Please create a new one.'
      : error?.message,
    isLoading: ['pending', 'idle'].includes(createQuoteStatus),
  };
};

export default function ReceiveSpark({ amount, account }: Props) {
  const navigate = useNavigateWithViewTransition();
  const [showOk, setShowOk] = useState(false);
  const [, copyToClipboard] = useCopyToClipboard();
  const { toast } = useToast();

  const { quote, errorMessage, isLoading } = useCreateQuote({
    account,
    amount,
    onPaid: (quote) => {
      navigate(`/transactions/${quote.transactionId}?redirectTo=/`, {
        transition: 'fade',
        applyTo: 'newView',
      });
    },
  });

  const handleCopy = (paymentRequest: string) => {
    copyToClipboard(paymentRequest);
    toast({
      title: 'Copied Lightning invoice',
      description: `${paymentRequest.slice(0, 5)}...${paymentRequest.slice(-5)}`,
      duration: 1000,
    });
    setShowOk(true);
  };

  return (
    <>
      <PageHeader>
        <ClosePageButton
          to="/receive"
          transition="slideDown"
          applyTo="oldView"
        />
        <PageHeaderTitle>Receive</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center overflow-x-hidden overflow-y-hidden">
        <MoneyWithConvertedAmount money={amount} />
        <QRCode
          value={quote?.paymentRequest}
          description="Scan with any Lightning wallet."
          error={errorMessage}
          isLoading={isLoading}
          onClick={quote ? () => handleCopy(quote.paymentRequest) : undefined}
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
