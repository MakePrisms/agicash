import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { QRCode } from '~/components/qr-code';
import {
  useCashuSendSwap,
  useTrackCashuSendSwap,
} from '~/features/send/cashu-send-swap-hooks';
import { ShareCashuToken } from '~/features/send/share-cashu-token';
import { MoneyWithConvertedAmount } from '~/features/shared/money-with-converted-amount';
import { getCashuProtocolUnit } from '~/lib/cashu';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import type { Route } from './+types/_protected.send.share.$swapId';

export default function SendShare({ params }: Route.ComponentProps) {
  const navigate = useNavigateWithViewTransition();

  const { data: swap } = useCashuSendSwap(params.swapId);

  useTrackCashuSendSwap({
    id: params.swapId,
    onCompleted: (swap) => {
      navigate(`/transactions/${swap.transactionId}?redirectTo=/`, {
        transition: 'fade',
        applyTo: 'newView',
      });
    },
  });

  // Skeleton view for DRAFT swaps. Once the swap is PENDING we have proofs to send and can show the token.
  // Once the swap is COMPLETED the onCompleted callback will navigate to the transaction page.
  if (swap.state !== 'PENDING' && swap.state !== 'COMPLETED') {
    return (
      <Page>
        <PageHeader>
          <ClosePageButton to="/" transition="slideDown" applyTo="oldView" />
          <PageHeaderTitle>Send</PageHeaderTitle>
        </PageHeader>
        <PageContent className="animate-in items-center gap-0 overflow-x-hidden overflow-y-hidden duration-300">
          <MoneyWithConvertedAmount money={swap.amountToSend} />
          <div className="flex w-full flex-col items-center justify-center px-4 py-4 pb-8">
            <QRCode isLoading={true} />
          </div>
        </PageContent>
      </Page>
    );
  }

  const token = {
    mint: swap.account.mintUrl,
    proofs: swap.proofsToSend,
    unit: getCashuProtocolUnit(swap.amountToSend.currency),
  };

  return <ShareCashuToken token={token} />;
}
