import { useState } from 'react';
import { useCopyToClipboard } from 'usehooks-ts';
import { MoneyDisplay } from '~/components/money-display';
import {
  ClosePageButton,
  PageContent,
  PageFooter,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { QRCode } from '~/components/qr-code';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import type { CashuAccount } from '~/features/accounts/account';
import { useEffectNoStrictMode } from '~/hooks/use-effect-no-strict-mode';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
import { useToast } from '~/hooks/use-toast';
import type { Money } from '~/lib/money';
import {
  LinkWithViewTransition,
  useNavigateWithViewTransition,
} from '~/lib/transitions';
import { getDefaultUnit } from '../shared/currencies';
import { MoneyWithConvertedAmount } from '../shared/money-with-converted-amount';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import {
  useCashuReceiveQuote,
  useCreateCashuReceiveQuote,
} from './cashu-receive-quote-hooks';

type CreateQuoteProps = {
  account: CashuAccount;
  amount: Money;
  onPaid: (quote: CashuReceiveQuote) => void;
};

const useCreateQuote = ({ account, amount, onPaid }: CreateQuoteProps) => {
  const {
    mutate: createQuote,
    data: createdQuote,
    status: createQuoteStatus,
    error,
  } = useCreateCashuReceiveQuote();

  const { quote, status: quotePaymentStatus } = useCashuReceiveQuote({
    quoteId: createdQuote?.id,
    onPaid: onPaid,
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

const AmountBreakdownCard = ({
  amount,
  mintingFee,
  className,
}: {
  amount: Money;
  mintingFee: Money;
  className?: string;
}) => {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col px-4 py-3">
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground">Receive</p>
          <div>
            <MoneyDisplay
              size="sm"
              money={amount}
              unit={getDefaultUnit(amount.currency)}
            />
          </div>
        </div>
        <div />
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground">Fee</p>
          <div>
            <MoneyDisplay
              size="sm"
              money={mintingFee}
              unit={getDefaultUnit(amount.currency)}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

type Props = {
  amount: Money;
  account: CashuAccount;
};

export default function ReceiveCashu({ amount, account }: Props) {
  const [showOk, setShowOk] = useState(false);
  const [, copyToClipboard] = useCopyToClipboard();
  const { toast } = useToast();
  const navigate = useNavigateWithViewTransition();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();

  const { quote, errorMessage, isLoading } = useCreateQuote({
    account,
    amount,
    onPaid: (quote) => {
      navigate(
        buildLinkWithSearchParams(`/transactions/${quote.transactionId}`),
        { transition: 'slideLeft', applyTo: 'newView' },
      );
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

  const { mintingFee, paymentRequest } = quote || {};

  const displayAmount = mintingFee ? amount.add(mintingFee) : amount;

  return (
    <>
      <PageHeader>
        <ClosePageButton
          to={buildLinkWithSearchParams('/receive')}
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>Receive Ecash</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center gap-4 overflow-y-auto overflow-x-hidden">
        <MoneyWithConvertedAmount money={displayAmount} />
        <QRCode
          value={paymentRequest}
          description="Scan with any Lightning wallet."
          error={errorMessage}
          isLoading={isLoading}
          onClick={
            paymentRequest ? () => handleCopy(paymentRequest) : undefined
          }
          className="gap-4"
          size={256}
        />
        {mintingFee && (
          <AmountBreakdownCard
            amount={amount}
            mintingFee={mintingFee}
            className="w-[256px] max-w-sm"
          />
        )}
      </PageContent>
      {showOk && (
        <PageFooter className="pb-14">
          <Button asChild className="w-[80px]">
            <LinkWithViewTransition
              to={buildLinkWithSearchParams('/receive')}
              transition="slideRight"
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
