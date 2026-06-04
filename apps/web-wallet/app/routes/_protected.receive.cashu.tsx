import { Page } from '~/components/page';
import { Redirect } from '~/components/redirect';
import { useAccount } from '~/features/accounts/account-hooks';
import ReceiveCashu from '~/features/receive/receive-cashu';
import { useReceiveStore } from '~/features/receive/receive-provider';

export default function ReceiveCashuPage() {
  const receiveAmount = useReceiveStore((state) => state.amount);
  const receiveAccountId = useReceiveStore((state) => state.accountId);
  const receiveAccount = useAccount(receiveAccountId);
  const shouldRedirect = !receiveAmount || receiveAccount.type !== 'cashu';

  if (shouldRedirect) {
    return <Redirect to="/receive" />;
  }

  return (
    <Page>
      <ReceiveCashu amount={receiveAmount} account={receiveAccount} />
    </Page>
  );
}
