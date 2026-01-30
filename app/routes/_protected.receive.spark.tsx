import { Page } from '~/components/page';
import { Redirect } from '~/components/redirect';
import { useAccount } from '~/features/accounts/account-hooks';
import { useReceiveStore } from '~/features/receive/receive-provider';
import ReceiveSpark from '~/features/receive/receive-spark';

export default function ReceiveSparkPage() {
  const receiveAmount = useReceiveStore((s) => s.amount);
  const receiveAccountId = useReceiveStore((s) => s.accountId);
  const receiveAccount = useAccount(receiveAccountId);

  if (!receiveAmount || !receiveAccount || receiveAccount.type !== 'spark') {
    return (
      <Redirect
        to="/receive"
        logMessage="Missing or incorrect values from the receive store"
      />
    );
  }

  return (
    <Page>
      <ReceiveSpark amount={receiveAmount} account={receiveAccount} />
    </Page>
  );
}
