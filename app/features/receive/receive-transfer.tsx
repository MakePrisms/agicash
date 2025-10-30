import { useState } from 'react';
import { MoneyDisplay } from '~/components/money-display';
import {
  ClosePageButton,
  PageContent,
  PageFooter,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import type { CashuAccount, SparkAccount } from '~/features/accounts/account';
import { useEffectNoStrictMode } from '~/hooks/use-effect-no-strict-mode';
import { useToast } from '~/hooks/use-toast';
import type { Money } from '~/lib/money';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import {
  useCreateCashuSendQuote,
  useInitiateCashuSendQuote,
} from '../send/cashu-send-quote-hooks';
import {
  useCreateSparkLightningQuote,
  usePaySparkLightningInvoice,
} from '../send/spark-send-lightning-hooks';
import { getDefaultUnit } from '../shared/currencies';
import { DomainError } from '../shared/error';
import { MoneyWithConvertedAmount } from '../shared/money-with-converted-amount';
import {
  useCashuReceiveQuote,
  useCreateCashuReceiveQuote,
} from './cashu-receive-quote-hooks';
import {
  useCreateSparkReceiveLightningQuote,
  useSparkReceiveQuote,
} from './spark-receive-lightning-hooks';

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

type TransferToCashuProps = {
  fromAccount: CashuAccount | SparkAccount;
  toAccount: CashuAccount;
  amount: Money;
};

/**
 * Transfer to a Cashu account from either a Cashu or Spark account.
 * Creates a mint quote on the destination account and pays it from the source account.
 */
function TransferToCashu({
  fromAccount,
  toAccount,
  amount,
}: TransferToCashuProps) {
  const { toast } = useToast();
  const navigate = useNavigateWithViewTransition();
  const [isTransferring, setIsTransferring] = useState(false);

  // Create receive quote on the destination Cashu account
  const { mutate: createReceiveQuote, data: receiveQuote } =
    useCreateCashuReceiveQuote();

  // Create send quote on the source account
  const { mutate: createCashuSendQuote, data: cashuSendQuote } =
    useCreateCashuSendQuote();
  const { mutate: createSparkQuote, data: sparkSendQuote } =
    useCreateSparkLightningQuote();

  const sendQuote =
    fromAccount.type === 'cashu' ? cashuSendQuote : sparkSendQuote;

  // Fetch quotes on mount
  useEffectNoStrictMode(() => {
    if (!receiveQuote) {
      createReceiveQuote({ account: toAccount, amount });
    }
  }, [receiveQuote, createReceiveQuote, amount, toAccount]);

  useEffectNoStrictMode(() => {
    if (receiveQuote?.paymentRequest && !sendQuote) {
      if (fromAccount.type === 'cashu') {
        createCashuSendQuote({
          account: fromAccount,
          paymentRequest: receiveQuote.paymentRequest,
        });
      } else {
        createSparkQuote({
          account: fromAccount,
          paymentRequest: receiveQuote.paymentRequest,
        });
      }
    }
  }, [
    receiveQuote,
    sendQuote,
    createCashuSendQuote,
    createSparkQuote,
    fromAccount,
  ]);

  // Track receive quote to navigate when payment is complete
  useCashuReceiveQuote({
    quoteId: isTransferring ? receiveQuote?.id : undefined,
    onPaid: (quote) => {
      setIsTransferring(false);
      navigate(`/transactions/${quote.transactionId}?redirectTo=/`, {
        transition: 'fade',
        applyTo: 'newView',
      });
    },
  });

  // For Cashu source accounts - initiate send quote
  const { mutate: initiateCashuSend } = useInitiateCashuSendQuote({
    onError: (error) => {
      setIsTransferring(false);
      if (error instanceof DomainError) {
        toast({ description: error.message });
      } else {
        console.error('Error initiating send quote', { cause: error });
        toast({
          title: 'Error',
          description: 'Failed to initiate transfer. Please try again.',
          variant: 'destructive',
        });
      }
    },
  });

  // For Spark source accounts - pay invoice
  const { mutate: paySparkInvoice } = usePaySparkLightningInvoice();

  const handleConfirm = () => {
    if (!sendQuote) return;

    setIsTransferring(true);

    if (fromAccount.type === 'cashu' && cashuSendQuote) {
      initiateCashuSend({
        accountId: fromAccount.id,
        sendQuote: cashuSendQuote,
      });
    } else if (fromAccount.type === 'spark' && sparkSendQuote) {
      paySparkInvoice({
        account: fromAccount,
        quote: sparkSendQuote,
      });
    }
  };

  // Calculate fees and total
  // Cashu receive quotes don't have fees (mints typically don't charge for receiving)
  // Send fee depends on account type
  const sendFee = cashuSendQuote
    ? cashuSendQuote.estimatedTotalFee
    : sparkSendQuote?.estimatedTotalFee;
  const totalAmount = sendFee ? amount.add(sendFee) : amount;

  return (
    <>
      <MoneyWithConvertedAmount money={totalAmount} />
      <Card className="m-4 w-full">
        <CardContent className="flex flex-col gap-6 pt-6">
          {[
            {
              label: 'Amount to receive',
              value: (
                <MoneyDisplay
                  size="sm"
                  money={amount}
                  unit={getDefaultUnit(amount.currency)}
                />
              ),
            },
            {
              label: 'Fees',
              value: sendFee ? (
                <MoneyDisplay
                  size="sm"
                  money={sendFee}
                  unit={getDefaultUnit(sendFee.currency)}
                />
              ) : (
                '...'
              ),
            },
            { label: 'From', value: fromAccount.name },
            { label: 'To', value: toAccount.name },
          ].map((row) => (
            <ConfirmationRow
              key={row.label}
              label={row.label}
              value={row.value}
            />
          ))}
        </CardContent>
      </Card>
      <PageFooter className="pb-14">
        <Button
          onClick={handleConfirm}
          loading={isTransferring}
          disabled={!sendQuote}
        >
          Confirm Transfer
        </Button>
      </PageFooter>
    </>
  );
}

type TransferToSparkProps = {
  fromAccount: CashuAccount | SparkAccount;
  toAccount: SparkAccount;
  amount: Money;
};

/**
 * Transfer to a Spark account from either a Cashu or Spark account.
 * Creates a lightning invoice on the destination account and pays it from the source account.
 */
function TransferToSpark({
  fromAccount,
  toAccount,
  amount,
}: TransferToSparkProps) {
  const { toast } = useToast();
  const navigate = useNavigateWithViewTransition();
  const [isTransferring, setIsTransferring] = useState(false);

  // Create receive quote on the destination Spark account
  const { mutate: createReceiveQuote, data: receiveQuote } =
    useCreateSparkReceiveLightningQuote();

  // Create send quote on the source account
  const { mutate: createCashuSendQuote, data: cashuSendQuote } =
    useCreateCashuSendQuote();
  const { mutate: createSparkQuote, data: sparkSendQuote } =
    useCreateSparkLightningQuote();

  const sendQuote =
    fromAccount.type === 'cashu' ? cashuSendQuote : sparkSendQuote;

  // Fetch quotes on mount
  useEffectNoStrictMode(() => {
    if (!receiveQuote) {
      createReceiveQuote({ account: toAccount, amount });
    }
  }, [receiveQuote, createReceiveQuote, amount, toAccount]);

  useEffectNoStrictMode(() => {
    if (receiveQuote?.paymentRequest && !sendQuote) {
      if (fromAccount.type === 'cashu') {
        createCashuSendQuote({
          account: fromAccount,
          paymentRequest: receiveQuote.paymentRequest,
        });
      } else {
        createSparkQuote({
          account: fromAccount,
          paymentRequest: receiveQuote.paymentRequest,
        });
      }
    }
  }, [
    receiveQuote,
    sendQuote,
    createCashuSendQuote,
    createSparkQuote,
    fromAccount,
  ]);

  // Track receive quote to navigate when payment is complete
  useSparkReceiveQuote({
    quoteId: isTransferring ? receiveQuote?.id : undefined,
    onCompleted: (quote) => {
      setIsTransferring(false);
      navigate(`/transactions/spark-${quote.transferId}?redirectTo=/`, {
        transition: 'fade',
        applyTo: 'newView',
      });
    },
  });

  // For Cashu source accounts - initiate send quote
  const { mutate: initiateCashuSend } = useInitiateCashuSendQuote({
    onError: (error) => {
      setIsTransferring(false);
      if (error instanceof DomainError) {
        toast({ description: error.message });
      } else {
        console.error('Error initiating send quote', { cause: error });
        toast({
          title: 'Error',
          description: 'Failed to initiate transfer. Please try again.',
          variant: 'destructive',
        });
      }
    },
  });

  // For Spark source accounts - pay invoice
  const { mutate: paySparkInvoice } = usePaySparkLightningInvoice();

  const handleConfirm = () => {
    if (!sendQuote) return;

    setIsTransferring(true);

    if (fromAccount.type === 'cashu' && cashuSendQuote) {
      initiateCashuSend({
        accountId: fromAccount.id,
        sendQuote: cashuSendQuote,
      });
    } else if (fromAccount.type === 'spark' && sparkSendQuote) {
      paySparkInvoice({
        account: fromAccount,
        quote: sparkSendQuote,
      });
    }
  };

  // Calculate fees and total
  // Spark receive quotes don't have fees
  // Send fee depends on account type
  const sendFee = cashuSendQuote
    ? cashuSendQuote.estimatedTotalFee
    : sparkSendQuote?.estimatedTotalFee;
  const totalAmount = sendFee ? amount.add(sendFee) : amount;

  return (
    <>
      <MoneyWithConvertedAmount money={totalAmount} />
      <Card className="m-4 w-full">
        <CardContent className="flex flex-col gap-6 pt-6">
          {[
            {
              label: 'Amount to receive',
              value: (
                <MoneyDisplay
                  size="sm"
                  money={amount}
                  unit={getDefaultUnit(amount.currency)}
                />
              ),
            },
            {
              label: 'Fees',
              value: sendFee ? (
                <MoneyDisplay
                  size="sm"
                  money={sendFee}
                  unit={getDefaultUnit(sendFee.currency)}
                />
              ) : (
                '...'
              ),
            },
            { label: 'From', value: fromAccount.name },
            { label: 'To', value: toAccount.name },
          ].map((row) => (
            <ConfirmationRow
              key={row.label}
              label={row.label}
              value={row.value}
            />
          ))}
        </CardContent>
      </Card>
      <PageFooter className="pb-14">
        <Button
          onClick={handleConfirm}
          loading={isTransferring}
          disabled={!sendQuote}
        >
          Confirm Transfer
        </Button>
      </PageFooter>
    </>
  );
}

type Props = {
  amount: Money;
  fromAccount: CashuAccount | SparkAccount;
  toAccount: CashuAccount | SparkAccount;
};

export default function ReceiveTransfer({
  amount,
  fromAccount,
  toAccount,
}: Props) {
  return (
    <>
      <PageHeader>
        <ClosePageButton
          to="/receive"
          transition="slideDown"
          applyTo="oldView"
        />
        <PageHeaderTitle>Transfer</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center overflow-x-hidden overflow-y-hidden">
        {toAccount.type === 'cashu' ? (
          <TransferToCashu
            fromAccount={fromAccount}
            toAccount={toAccount}
            amount={amount}
          />
        ) : (
          <TransferToSpark
            fromAccount={fromAccount}
            toAccount={toAccount}
            amount={amount}
          />
        )}
      </PageContent>
    </>
  );
}
