import {
  PageBackButton,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { QRScanner } from '~/components/qr-scanner';
import { useExchangeRate } from '~/hooks/use-exchange-rate';
import { useToast } from '~/hooks/use-toast';
import type { Money } from '~/lib/money';
import { useNavigateWithViewTransition } from '~/lib/transitions/view-transition';
import type { Account } from '../accounts/account';
import { useSendStore } from './send-provider';

/**
 * Converts an amount to the send account currency.
 * If the amount is already in the send account currency, returns the amount.
 *
 * @throws if the exchange rate fails to load
 */
const useConverter = (sendAccount: Account) => {
  const otherCurrency = sendAccount.currency === 'BTC' ? 'USD' : 'BTC';

  const { data: rate } = useExchangeRate(
    `${otherCurrency}-${sendAccount.currency}`,
  );

  return (amount: Money) => {
    if (!rate) throw new Error('Exchange rate not found');

    return amount.convert(sendAccount.currency, rate);
  };
};

export default function SendScanner() {
  const { toast } = useToast();
  const navigate = useNavigateWithViewTransition();

  const sendAccount = useSendStore((state) => state.getSourceAccount());
  const selectDestination = useSendStore((state) => state.selectDestination);
  const continueSend = useSendStore((state) => state.proceedWithSend);

  const convert = useConverter(sendAccount);

  const handleDecode = async (input: string) => {
    const selectDestinationResult = await selectDestination(input);
    if (!selectDestinationResult.success) {
      // TODO: implement this https://github.com/MakePrisms/agicash/pull/331#discussion_r2024690976
      return toast({
        title: 'Invalid input',
        description: selectDestinationResult.error,
        variant: 'destructive',
      });
    }

    const { amount } = selectDestinationResult.data;

    if (!amount) {
      // Navigate to send input to enter the amount
      return navigate('/send', {
        applyTo: 'oldView',
        transition: 'slideDown',
      });
    }

    const convertedAmount =
      amount.currency !== sendAccount.currency ? convert(amount) : undefined;
    const result = await continueSend(amount, convertedAmount);

    if (!result.success || result.next !== 'confirmQuote') {
      return toast({
        title: 'Error',
        description: 'Failed to get a send quote. Please try again',
        variant: 'destructive',
      });
    }

    navigate('/send/confirm', {
      applyTo: 'newView',
      transition: 'slideUp',
    });
  };

  return (
    <>
      <PageHeader className="z-10">
        <PageBackButton to="/send" transition="slideDown" applyTo="oldView" />
        <PageHeaderTitle>Scan</PageHeaderTitle>
      </PageHeader>
      <PageContent className="relative flex items-center justify-center">
        <QRScanner onDecode={handleDecode} />
      </PageContent>
    </>
  );
}
