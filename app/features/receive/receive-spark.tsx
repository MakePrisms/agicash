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
import { useToast } from '~/hooks/use-toast';
import type { Money } from '~/lib/money';
import { LinkWithViewTransition } from '~/lib/transitions';
import { getErrorMessage } from '../shared/error';
import { MoneyWithConvertedAmount } from '../shared/money-with-converted-amount';
import type { SparkLightningReceive } from './spark-lightning-receive-service';

type Props = {
  request: SparkLightningReceive | null;
  amount: Money;
  error?: Error | null;
};

export default function ReceiveSpark({ request, amount, error }: Props) {
  const [showOk, setShowOk] = useState(false);
  const [, copyToClipboard] = useCopyToClipboard();
  const { toast } = useToast();

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
          isLoading={!request}
          value={request?.paymentRequest}
          description="Scan with any Lightning wallet."
          error={
            error
              ? getErrorMessage(error)
              : request?.state === 'FAILED'
                ? 'Failed to receive payment'
                : request?.state === 'EXPIRED'
                  ? 'Payment expired'
                  : undefined
          }
          onClick={
            request ? () => handleCopy(request.paymentRequest) : undefined
          }
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
