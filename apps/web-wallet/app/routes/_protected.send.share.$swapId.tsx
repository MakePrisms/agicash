import { getCashuProtocolUnit } from '@agicash/cashu';
import { toProof } from '~/features/accounts/cashu-account';
import {
  useCashuSendSwap,
  useTrackCashuSendSwap,
} from '~/features/send/cashu-send-swap-hooks';
import { ShareCashuToken } from '~/features/send/share-cashu-token';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import type { Route } from './+types/_protected.send.share.$swapId';

export default function SendShare({ params }: Route.ComponentProps) {
  const navigate = useNavigateWithViewTransition();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();

  const { data: swap } = useCashuSendSwap(params.swapId);

  useTrackCashuSendSwap({
    id: params.swapId,
    onCompleted: (swap) => {
      navigate(
        buildLinkWithSearchParams(`/transactions/${swap.transactionId}`, {
          showOkButton: 'true',
        }),
        {
          transition: 'fade',
          applyTo: 'newView',
        },
      );
    },
  });

  const token =
    swap.state === 'PENDING' || swap.state === 'COMPLETED'
      ? {
          mint: swap.account.mintUrl,
          proofs: swap.proofsToSend.map((p) => toProof(p)),
          unit: getCashuProtocolUnit(swap.amountToSend.currency),
        }
      : undefined;

  return <ShareCashuToken amount={swap.amountToSend} token={token} />;
}
