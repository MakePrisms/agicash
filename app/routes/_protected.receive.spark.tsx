import { Page } from '~/components/page';
import { Redirect } from '~/components/redirect';
import { useAccount } from '~/features/accounts/account-hooks';
import { useReceiveStore } from '~/features/receive/receive-provider';
import ReceiveSpark from '~/features/receive/receive-spark';

export default function ReceiveSparkPage() {
  const receiveAmount = useReceiveStore((state) => state.amount);
  const receiveAccountId = useReceiveStore((state) => state.accountId);
  const receiveAccount = useAccount(receiveAccountId);
  const shouldRedirect = !receiveAmount || receiveAccount.type !== 'spark';

  if (shouldRedirect) {
    return <Redirect to="/receive" />;
  }

  return (
    <Page>
      <ReceiveSpark amount={receiveAmount} account={receiveAccount} />
    </Page>
  );
}
