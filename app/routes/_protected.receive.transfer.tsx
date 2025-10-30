import { Page } from '~/components/page';
import { Redirect } from '~/components/redirect';
import {
  useAccount,
  useDefaultAccount,
} from '~/features/accounts/account-hooks';
import { useReceiveStore } from '~/features/receive/receive-provider';
import ReceiveTransfer from '~/features/receive/receive-transfer';

export default function ReceiveTransferPage() {
  const receiveAmount = useReceiveStore((state) => state.amount);
  const receiveAccountId = useReceiveStore((state) => state.accountId);
  const payFromDefaultAccount = useReceiveStore(
    (state) => state.payFromDefaultAccount,
  );
  const receiveAccount = useAccount(receiveAccountId);
  const defaultAccount = useDefaultAccount();

  // Only allow transfers when:
  // - Amount is set
  // - payFromDefaultAccount is enabled
  // - Receive account is not the default account
  // - Receive account is Cashu (non-test) or Spark
  // - Default account is Cashu (non-test) or Spark
  const shouldRedirect =
    !receiveAmount ||
    !payFromDefaultAccount ||
    receiveAccount.isDefault ||
    defaultAccount.type === 'nwc' ||
    (defaultAccount.type === 'cashu' && defaultAccount.isTestMint) ||
    (receiveAccount.type === 'cashu' && receiveAccount.isTestMint) ||
    receiveAccount.type === 'nwc';

  if (shouldRedirect) {
    return <Redirect to="/receive" />;
  }

  return (
    <Page>
      <ReceiveTransfer
        amount={receiveAmount}
        fromAccount={defaultAccount}
        toAccount={receiveAccount}
      />
    </Page>
  );
}
