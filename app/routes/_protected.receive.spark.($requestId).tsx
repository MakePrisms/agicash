import { useNavigate } from 'react-router';
import { Page } from '~/components/page';
import { Redirect } from '~/components/redirect';
import { useAccount } from '~/features/accounts/account-hooks';
import { useReceiveStore } from '~/features/receive/receive-provider';
import ReceiveSpark from '~/features/receive/receive-spark';
import {
  useCreateSparkLightningReceive,
  useTrackSparkLightningReceive,
} from '~/features/receive/spark-lightning-receive-hooks';
import { getDefaultUnit } from '~/features/shared/currencies';
import { useEffectNoStrictMode } from '~/hooks/use-effect-no-strict-mode';
import { useToast } from '~/hooks/use-toast';
import type { Money } from '~/lib/money';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import type { Route } from './+types/_protected.receive.spark.($requestId)';

export default function ReceiveSparkPage({ params }: Route.ComponentProps) {
  const { requestId } = params;
  const receiveAmount = useReceiveStore((s) => s.amount);
  const receiveAccountId = useReceiveStore((s) => s.accountId);
  const receiveAccount = useAccount(receiveAccountId);

  if (!requestId) {
    if (!receiveAmount || !receiveAccount || receiveAccount.type !== 'spark') {
      return (
        <Redirect
          to="/receive"
          logMessage="Missing or incorrect values from the receive store"
        />
      );
    }
    return <CreateSparkRequest amount={receiveAmount} />;
  }

  return <TrackSparkRequest requestId={requestId} />;
}

type CreateSparkRequestProps = {
  amount: Money;
};

function CreateSparkRequest({ amount }: CreateSparkRequestProps) {
  const navigate = useNavigate();
  const { mutate: createSparkLightningReceive, error } =
    useCreateSparkLightningReceive({
      onSuccess: (request) => {
        navigate(`/receive/spark/${request.id}`, {
          replace: true,
        });
      },
    });

  useEffectNoStrictMode(() => {
    createSparkLightningReceive({ amount });
  }, [amount, createSparkLightningReceive]);

  return (
    <Page>
      <ReceiveSpark request={null} error={error} amount={amount} />
    </Page>
  );
}

type TrackSparkRequestProps = {
  requestId: string;
};

function TrackSparkRequest({ requestId }: TrackSparkRequestProps) {
  const navigate = useNavigateWithViewTransition();
  const { toast } = useToast();

  const { request } = useTrackSparkLightningReceive({
    requestId,
    onCompleted: ({ amount }) => {
      // TODO: go to transaction details when we have it
      toast({
        title: `Received ${amount.toLocaleString({ unit: getDefaultUnit(amount.currency) })}`,
      });
      navigate('/', {
        transition: 'fade',
        applyTo: 'newView',
      });
    },
  });

  return (
    <Page>
      <ReceiveSpark request={request} amount={request.amount} />
    </Page>
  );
}
