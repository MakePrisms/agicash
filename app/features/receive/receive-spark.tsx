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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';
import { formatCountdown, useCountdown } from '~/hooks/use-countdown';
import { useEffectNoStrictMode } from '~/hooks/use-effect-no-strict-mode';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
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

  const secondsRemaining = useCountdown(quote?.expiresAt);
  const isExpired =
    quotePaymentStatus === 'EXPIRED' || (secondsRemaining === 0 && !!quote);

  useEffectNoStrictMode(() => {
    if (!quote && createQuoteStatus === 'idle') {
      createQuote({ account, amount });
    }
  }, [quote, createQuoteStatus, createQuote, amount, account]);

  return {
    quote,
    secondsRemaining,
    errorMessage: isExpired
      ? 'This invoice has expired. Refresh to create a new one.'
      : error?.message,
    isLoading: ['pending', 'idle'].includes(createQuoteStatus),
    regenerate: () => createQuote({ account, amount }),
  };
};

export default function ReceiveSpark({ amount, account }: Props) {
  const [showOk, setShowOk] = useState(false);
  const [, copyToClipboard] = useCopyToClipboard();
  const { toast } = useToast();
  const navigate = useNavigateWithViewTransition();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();

  const { quote, secondsRemaining, errorMessage, isLoading, regenerate } =
    useCreateQuote({
      account,
      amount,
      onPaid: (quote) => {
        navigate(
          buildLinkWithSearchParams(`/transactions/${quote.transactionId}`, {
            showOkButton: 'true',
          }),
          { transition: 'fade', applyTo: 'newView' },
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

  return (
    <>
      <PageHeader>
        <ClosePageButton
          to={buildLinkWithSearchParams('/receive')}
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>Receive</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center overflow-x-hidden overflow-y-hidden">
        <MoneyWithConvertedAmount money={amount} />
        <QRCode
          value={quote?.paymentRequest}
          description={
            errorMessage ? undefined : 'Scan with any Lightning wallet.'
          }
          error={errorMessage}
          isLoading={isLoading}
          onClick={quote ? () => handleCopy(quote.paymentRequest) : undefined}
        />
        {!errorMessage && !isLoading && quote && (
          <Popover>
            <PopoverTrigger asChild>
              <p className="text-center text-muted-foreground text-xs tabular-nums">
                Expires in {formatCountdown(secondsRemaining)}
              </p>
            </PopoverTrigger>
            <PopoverContent className="w-auto px-3 py-2">
              <p className="text-xs">
                {new Date(quote.expiresAt).toLocaleString()}
              </p>
            </PopoverContent>
          </Popover>
        )}
      </PageContent>
      {errorMessage && (
        <PageFooter className="pb-14">
          <Button onClick={regenerate} loading={isLoading}>
            Refresh
          </Button>
        </PageFooter>
      )}
      {showOk && !errorMessage && (
        <PageFooter className="pb-14">
          <Button asChild className="w-[80px]">
            <LinkWithViewTransition
              to={buildLinkWithSearchParams('/receive')}
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
