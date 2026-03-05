import { Redirect } from '~/components/redirect';
import TransferConfirmation from '~/features/transfer/transfer-confirmation';
import { useTransferStore } from '~/features/transfer/transfer-provider';

export default function GiftCardTransferConfirmRoute() {
  const transferQuote = useTransferStore((s) => s.transferQuote);

  if (!transferQuote) {
    return (
      <Redirect to=".." logMessage="No transfer quote, redirecting to input" />
    );
  }

  return <TransferConfirmation transferQuote={transferQuote} />;
}
