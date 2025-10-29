import { Redirect } from '~/components/redirect';
import {
  CreateCashuTokenConfirmation,
  PayBolt11Confirmation,
} from '~/features/send';
import { useSendStore } from '~/features/send';

export default function SendConfirmationPage() {
  const {
    sendType,
    getSourceAccount,
    amount: sendAmount,
    destination,
    destinationDisplay,
    destinationDetails,
    quote,
  } = useSendStore();
  const sendAccount = getSourceAccount();

  if (!sendAmount || !sendType || !sendAccount) {
    return <Redirect to="/send" logMessage="Missing send data" />;
  }

  if (sendAccount.type !== 'cashu' && sendAccount.type !== 'spark') {
    return <Redirect to="/send" logMessage="Invalid sending account" />;
  }

  if (
    sendType === 'BOLT11_INVOICE' ||
    sendType === 'LN_ADDRESS' ||
    sendType === 'AGICASH_CONTACT'
  ) {
    if (!destination || !destinationDisplay || !quote) {
      return <Redirect to="/send" logMessage="Missing destination data" />;
    }

    const details =
      sendType === 'LN_ADDRESS'
        ? ({
            sendType,
            lnAddress: destinationDetails.lnAddress,
          } as const)
        : sendType === 'AGICASH_CONTACT'
          ? ({
              sendType,
              contactId: destinationDetails.id,
            } as const)
          : undefined;

    return (
      <PayBolt11Confirmation
        account={sendAccount}
        quote={quote}
        destination={destination}
        destinationDisplay={destinationDisplay}
        destinationDetails={details}
      />
    );
  }

  if (sendType === 'CASHU_TOKEN') {
    if (!quote) {
      return <Redirect to="/send" logMessage="Missing quote" />;
    }

    if (sendAccount.type !== 'cashu') {
      return (
        <Redirect
          to="/send"
          logMessage="Cannot create Cashu token from non-Cashu account"
        />
      );
    }

    return <CreateCashuTokenConfirmation quote={quote} account={sendAccount} />;
  }

  return <Redirect to="/send" logMessage="Invalid send type" />;
}
