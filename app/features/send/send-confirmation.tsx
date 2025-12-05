import { AlertCircle } from 'lucide-react';
import { MoneyDisplay } from '~/components/money-display';
import { PageFooter, PageHeaderTitle } from '~/components/page';
import { PageBackButton } from '~/components/page';
import { PageHeader } from '~/components/page';
import { Page } from '~/components/page';
import { PageContent } from '~/components/page';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import type { CashuAccount, SparkAccount } from '~/features/accounts/account';
import type { CashuLightningQuote } from '~/features/send/cashu-send-quote-service';
import { MoneyWithConvertedAmount } from '~/features/shared/money-with-converted-amount';
import type { DestinationDetails } from '~/features/transactions/transaction';
import { useToast } from '~/hooks/use-toast';
import { decodeBolt11 } from '~/lib/bolt11';
import type { Money } from '~/lib/money';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import { getDefaultUnit } from '../shared/currencies';
import { DomainError } from '../shared/error';
import { useInitiateCashuSendQuote } from './cashu-send-quote-hooks';
import { useCreateCashuSendSwap } from './cashu-send-swap-hooks';
import type { CashuSwapQuote } from './cashu-send-swap-service';
import { useInitiateSparkLightningSend } from './spark-lightning-send-hooks';
import type { SparkLightningSendQuote } from './spark-lightning-send-service';

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

/**
 * Base confirmation component that displays the amount, the confirmation rows, and a confirm button
 */
const BaseConfirmation = ({
  amount,
  onConfirm,
  children,
  loading,
  error,
}: {
  amount: Money;
  children: React.ReactNode;
  onConfirm: () => void;
  loading?: boolean;
  error?: string;
}) => {
  return (
    <Page>
      <PageHeader className="z-10">
        <PageBackButton to="/send" transition="slideDown" applyTo="oldView" />
        <PageHeaderTitle>Confirm Payment</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center gap-4">
        <MoneyWithConvertedAmount money={amount} />
        <div className="absolute top-0 right-0 bottom-0 left-0 mx-auto flex max-w-sm items-center justify-center">
          <Card className="m-4 w-full">
            <CardContent className="flex flex-col gap-6 pt-6">
              {error ? (
                <div className="flex flex-col items-center justify-center gap-2 p-4">
                  <AlertCircle className="h-8 w-8 text-foreground" />
                  <p className="text-center text-muted-foreground text-sm">
                    {error}
                  </p>
                </div>
              ) : (
                children
              )}
            </CardContent>
          </Card>
        </div>
      </PageContent>
      <PageFooter className="pb-14">
        <Button onClick={onConfirm} loading={loading} disabled={!!error}>
          Confirm
        </Button>
      </PageFooter>
    </Page>
  );
};

type UsePayBolt11Props = {
  /** The account to send from. */
  account: CashuAccount | SparkAccount;
  /** The quote to pay. */
  quote: CashuLightningQuote | SparkLightningSendQuote;
  /** Additional details about the destination to include in the Agicash DB record.*/
  destinationDetails?: DestinationDetails;
};

/**
 * A hook that is used to pay bolt11 invoices from a Cashu account or a Spark account.
 * @param account - The account to send from.
 * @param quote - The quote to pay
 * @returns A function to handle the confirmation of the payment and a boolean indicating if the payment is pending.
 */
const usePayBolt11 = ({
  account,
  quote,
  destinationDetails,
}: UsePayBolt11Props) => {
  const { toast } = useToast();
  const navigate = useNavigateWithViewTransition();

  const { mutate: initiateCashuSend, status: createCashuSendQuoteStatus } =
    useInitiateCashuSendQuote({
      onSuccess: (data) => {
        navigate(`/transactions/${data.transactionId}?redirectTo=/`, {
          transition: 'slideLeft',
          applyTo: 'newView',
        });
      },
      onError: (error) => {
        if (error instanceof DomainError) {
          toast({ description: error.message });
        } else {
          console.error('Failed to create cashu send quote', { cause: error });
          toast({
            title: 'Error',
            description: 'Failed to initiate the send. Please try again.',
            variant: 'destructive',
          });
        }
      },
    });

  const { mutate: initiateSparkSend, status: initiateSparkSendStatus } =
    useInitiateSparkLightningSend({
      onSuccess: (request) => {
        navigate(`/send/spark/${request.id}`, {
          transition: 'slideLeft',
          applyTo: 'newView',
        });
      },
      onError: (error) => {
        console.error('Error initiating spark send', { cause: error });
        toast({
          title: 'Error',
          description: 'Failed to initiate spark send. Please try again.',
        });
      },
    });

  const handleConfirm = () => {
    if (account.type === 'cashu') {
      initiateCashuSend({
        accountId: account.id,
        sendQuote: quote as CashuLightningQuote,
        destinationDetails,
      });
    } else if (account.type === 'spark') {
      initiateSparkSend({
        quote: quote as SparkLightningSendQuote,
      });
    }
  };

  const isPending =
    account.type === 'cashu'
      ? ['pending', 'success'].includes(createCashuSendQuoteStatus)
      : ['pending', 'success'].includes(initiateSparkSendStatus);

  return { handleConfirm, isPending };
};

type PayBolt11ConfirmationProps = {
  /** The account to send from */
  account: CashuAccount | SparkAccount;
  /** The bolt11 invoice to pay */
  destination: string;
  /** The destination to display in the UI. For sends to bolt11 this will be the same as the bolt11, for ln addresses it will be the ln address. */
  destinationDisplay: string;
  destinationDetails?: DestinationDetails;
  /** The quote to display in the UI. */
  quote: CashuLightningQuote | SparkLightningSendQuote;
};

/**
 * Confirmation component for paying a bolt11 invoice from a Cashu or Spark account.
 *
 * For Cashu accounts: Creates a melt quote to estimate the fee, then once confirmed,
 * gets proofs matching the total amount (fee + invoice amount) and gives them to the mint to melt.
 *
 * For Spark accounts: Initiates a Lightning send using the Spark SDK.
 */
export const PayBolt11Confirmation = ({
  account,
  quote: bolt11Quote,
  destination,
  destinationDisplay,
  destinationDetails,
}: PayBolt11ConfirmationProps) => {
  const { handleConfirm, isPending } = usePayBolt11({
    account,
    quote: bolt11Quote,
    destinationDetails,
  });

  const { description } = decodeBolt11(destination);

  return (
    <BaseConfirmation
      amount={bolt11Quote.estimatedTotalAmount}
      onConfirm={handleConfirm}
      loading={isPending}
    >
      {[
        {
          label: 'Recipient gets',
          value: (
            <MoneyDisplay
              size="sm"
              money={bolt11Quote.amountToReceive}
              unit={getDefaultUnit(bolt11Quote.amountToReceive.currency)}
            />
          ),
        },
        {
          label: 'Estimated fee',
          value: (
            <MoneyDisplay
              size="sm"
              money={bolt11Quote.estimatedTotalFee}
              unit={getDefaultUnit(bolt11Quote.estimatedTotalFee.currency)}
            />
          ),
        },
        { label: 'From', value: account.name },
        { label: 'Paying', value: destinationDisplay },
      ].map((row) => (
        <ConfirmationRow key={row.label} label={row.label} value={row.value} />
      ))}
      {description && (
        <div className="flex items-center justify-between gap-12">
          <p className="text-muted-foreground">Memo</p>
          <p className=" truncate ">{description}</p>
        </div>
      )}
    </BaseConfirmation>
  );
};

type CreateCashuTokenConfirmationProps = {
  quote: CashuSwapQuote;
  account: CashuAccount;
};

/**
 * This component is used to create a cashu token.
 * From a cashu account, we can create a token by swapping proofs we have
 * for the amount we want to send, then encoding as a token.
 *
 * This component should first estimate the fee for the swap, then once the user confirms
 * the payment details, it creates the token and navigates to the share page.
 */
export const CreateCashuTokenConfirmation = ({
  quote,
  account,
}: CreateCashuTokenConfirmationProps) => {
  const navigate = useNavigateWithViewTransition();
  const { toast } = useToast();

  const { mutate: createCashuSendSwap, status: createSwapStatus } =
    useCreateCashuSendSwap({
      onSuccess: (swap) => {
        navigate(`/send/share/${swap.id}`, {
          transition: 'slideUp',
          applyTo: 'newView',
        });
      },
      onError: (error) => {
        if (error instanceof DomainError) {
          toast({ description: error.message });
        } else {
          console.error('Failed to create cashu send swap', { cause: error });
          toast({
            title: 'Error',
            description: 'Failed to initiate the send. Please try again.',
          });
        }
      },
    });

  return (
    <BaseConfirmation
      amount={quote.totalAmount}
      onConfirm={() =>
        createCashuSendSwap({
          accountId: account.id,
          amount: quote.amountRequested,
        })
      }
      // there is a delay between the swap being created and navigating to the share page
      // so we show a loading state while the mutation is pending, then wait for navigation after mutation is complete
      loading={['pending', 'success'].includes(createSwapStatus)}
    >
      {[
        {
          label: 'Recipient gets',
          value: (
            <MoneyDisplay
              size="sm"
              money={quote.amountRequested}
              unit={getDefaultUnit(quote.amountRequested.currency)}
            />
          ),
        },
        {
          label: 'Estimated fee',
          value: (
            <MoneyDisplay
              size="sm"
              money={quote.totalFee}
              unit={getDefaultUnit(quote.totalFee.currency)}
            />
          ),
        },
        { label: 'From', value: account.name },
        { label: 'Sending', value: 'ecash' },
      ].map((row) => (
        <ConfirmationRow key={row.label} label={row.label} value={row.value} />
      ))}
    </BaseConfirmation>
  );
};
