import { Page } from '~/components/page';
import { Redirect } from '~/components/redirect';
import TransferConfirmation from '~/features/transfer/transfer-confirmation';
import { useTransferStore } from '~/features/transfer/transfer-provider';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';

export default function TransferConfirmPage() {
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();
  const quote = useTransferStore((s) => s.quote);
  const destinationAccountId = useTransferStore((s) => s.destinationAccountId);

  if (!quote) {
    return (
      <Redirect
        to={buildLinkWithSearchParams(`/transfer/${destinationAccountId}`)}
        logMessage="Missing transfer plan"
      />
    );
  }

  return (
    <Page>
      <TransferConfirmation
        quote={quote}
        destinationAccountId={destinationAccountId}
      />
    </Page>
  );
}
