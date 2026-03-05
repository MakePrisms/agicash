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
import { useToast } from '~/hooks/use-toast';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import { useAccount } from '../accounts/account-hooks';
import { getDefaultUnit } from '../shared/currencies';
import { DomainError } from '../shared/error';
import { useInitiateTransfer } from './transfer-hooks';
import { useTransferStore } from './transfer-provider';
import type { TransferQuote } from './transfer-service';

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

type TransferConfirmationProps = {
  transferQuote: TransferQuote;
};

export default function TransferConfirmation({
  transferQuote,
}: TransferConfirmationProps) {
  const { toast } = useToast();
  const navigate = useNavigateWithViewTransition();

  const destinationAccountId = useTransferStore((s) => s.destinationAccountId);
  const sourceAccountId = useTransferStore((s) => s.sourceAccountId);

  const destinationAccount = useAccount(destinationAccountId);
  const sourceAccount = useAccount(sourceAccountId);

  const { mutate: initiateTransfer, status: transferStatus } =
    useInitiateTransfer({
      onSuccess: ({ receiveTransactionId }) => {
        const params = new URLSearchParams({
          showOkButton: 'true',
          redirectTo: `/gift-cards/${destinationAccount.id}`,
        });
        navigate(
          {
            pathname: `/transactions/${receiveTransactionId}`,
            search: params.toString(),
          },
          {
            transition: 'slideLeft',
            applyTo: 'newView',
          },
        );
      },
      onError: (error) => {
        if (error instanceof DomainError) {
          toast({ description: error.message });
        } else {
          console.error('Failed to initiate transfer', { cause: error });
          toast({
            description: 'Transfer failed. Please try again.',
            variant: 'destructive',
          });
        }
      },
    });

  const handleConfirm = () => {
    initiateTransfer({
      sourceAccount,
      destinationAccount,
      transferQuote,
    });
  };

  const isPending = ['pending', 'success'].includes(transferStatus);

  return (
    <>
      <PageHeader className="z-10">
        <PageBackButton to=".." transition="slideRight" applyTo="oldView" />
        <PageHeaderTitle>Confirm</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center gap-4">
        <MoneyWithConvertedAmount money={transferQuote.estimatedTotal} />
        <div className="absolute top-0 right-0 bottom-0 left-0 mx-auto flex max-w-sm items-center justify-center">
          <Card className="m-4 w-full">
            <CardContent className="flex flex-col gap-6 pt-6">
              <ConfirmationRow
                label="Amount"
                value={
                  <MoneyDisplay
                    size="sm"
                    money={transferQuote.amount}
                    unit={getDefaultUnit(transferQuote.amount.currency)}
                  />
                }
              />
              <ConfirmationRow
                label="Estimated fee"
                value={
                  <MoneyDisplay
                    size="sm"
                    money={transferQuote.estimatedFee}
                    unit={getDefaultUnit(transferQuote.estimatedFee.currency)}
                  />
                }
              />
              <ConfirmationRow label="From" value={sourceAccount.name} />
              <ConfirmationRow label="To" value={destinationAccount.name} />
            </CardContent>
          </Card>
        </div>
      </PageContent>
      <PageFooter className="pb-14">
        <Button onClick={handleConfirm} loading={isPending}>
          Confirm
        </Button>
      </PageFooter>
    </>
  );
}
