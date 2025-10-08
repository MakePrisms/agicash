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
import type { CashuAccount } from '~/features/accounts/account';
import { useEffectNoStrictMode } from '~/hooks/use-effect-no-strict-mode';
import { useToast } from '~/hooks/use-toast';
import type { Money } from '~/lib/money';
import {
  LinkWithViewTransition,
  useNavigateWithViewTransition,
} from '~/lib/transitions';
import { MoneyWithConvertedAmount } from '../shared/money-with-converted-amount';
import type { Transaction } from '../transactions/transaction';
import { useTrackTransaction } from '../transactions/transaction-hooks';
import {
  useCashuReceiveQuote,
  useCreateCashuReceiveQuote,
} from './cashu-receive-quote-hooks';

type MintQuoteProps = {
  account: CashuAccount;
  amount: Money;
  onPaid: (quote: Transaction) => void;
  onCopy?: (paymentRequest: string) => void;
};

function MintQuoteCarouselItem({
  account,
  amount,
  onPaid,
  onCopy,
}: MintQuoteProps) {
  const {
    mutate: createQuote,
    data: createdQuote,
    status: createQuoteStatus,
    error,
  } = useCreateCashuReceiveQuote();

  const { quote, status: quotePaymentStatus } = useCashuReceiveQuote({
    quoteId: createdQuote?.id,
  });

  useTrackTransaction({
    transactionId: createdQuote?.transactionId,
    onCompleted: onPaid,
  });

  const isExpired = quotePaymentStatus === 'EXPIRED';

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
        isExpired
          ? 'This invoice has expired. Please create a new one.'
          : error?.message
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
  account: CashuAccount;
};

export default function ReceiveCashu({ amount, account }: Props) {
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

  return (
    <>
      <PageHeader>
        <ClosePageButton
          to="/receive"
          transition="slideDown"
          applyTo="oldView"
        />
        <PageHeaderTitle>Receive Ecash</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center overflow-x-hidden overflow-y-hidden">
        <MoneyWithConvertedAmount money={amount} />
        <MintQuoteCarouselItem
          account={account}
          amount={amount}
          onPaid={(transaction) => {
            navigate(`/transactions/${transaction.id}?redirectTo=/`, {
              transition: 'slideLeft',
              applyTo: 'newView',
            });
          }}
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
