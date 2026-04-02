import { getDefaultUnit } from '@agicash/sdk/features/shared/currencies';
import { DomainError } from '@agicash/sdk/features/shared/error';
import { MoneyDisplay } from '~/components/money-display';
import {
  PageBackButton,
  PageContent,
  PageFooter,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { MoneyWithConvertedAmount } from '~/features/shared/money-with-converted-amount';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
import { useToast } from '~/hooks/use-toast';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import { useInitiateTransfer } from './transfer-hooks';
import type { TransferQuote } from './transfer-service';

type Props = {
  quote: TransferQuote;
};

export default function TransferConfirmation({ quote }: Props) {
  const navigate = useNavigateWithViewTransition();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();
  const { toast } = useToast();
  const { mutate: initiateTransfer, status } = useInitiateTransfer();
  const destinationAccountId = quote.receive.account.id;

  const handleConfirm = () => {
    initiateTransfer(
      { quote },
      {
        onSuccess: (result) => {
          navigate(
            buildLinkWithSearchParams(
              `/transactions/${result.receiveTransactionId}`,
              { showOkButton: 'true' },
            ),
            { transition: 'slideLeft', applyTo: 'newView' },
          );
        },
        onError: (error) => {
          if (error instanceof DomainError) {
            toast({ description: error.message });
          } else {
            console.error('Failed to initiate transfer', { cause: error });
            toast({
              description: 'Failed to initiate transfer. Please try again.',
              variant: 'destructive',
            });
          }
        },
      },
    );
  };

  return (
    <>
      <PageHeader className="z-10">
        <PageBackButton
          to={buildLinkWithSearchParams(`/transfer/${destinationAccountId}`)}
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>Confirm</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center gap-4">
        <MoneyWithConvertedAmount money={quote.totalCost} />
        <div className="absolute top-0 right-0 bottom-0 left-0 mx-auto flex max-w-sm items-center justify-center">
          <Card className="m-4 w-full">
            <CardContent className="flex flex-col gap-6 pt-6">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground">Amount to add</p>
                <MoneyDisplay
                  size="sm"
                  money={quote.amountToReceive}
                  unit={getDefaultUnit(quote.amountToReceive.currency)}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground">Fees</p>
                <MoneyDisplay
                  size="sm"
                  money={quote.totalFees}
                  unit={getDefaultUnit(quote.totalFees.currency)}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground">From</p>
                <p>{quote.send.account.name}</p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground">To</p>
                <p>{quote.receive.account.name}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </PageContent>
      <PageFooter className="pb-14">
        <Button
          onClick={handleConfirm}
          loading={['pending', 'success'].includes(status)}
        >
          Confirm
        </Button>
      </PageFooter>
    </>
  );
}
