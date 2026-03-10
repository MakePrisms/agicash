import { Outlet, useSearchParams } from 'react-router';
import {
  useAccount,
  useAccountOrDefault,
} from '~/features/accounts/account-hooks';
import { TransferProvider } from '~/features/transfer/transfer-provider';

export default function TransferLayout() {
  const [searchParams] = useSearchParams();
  const destinationAccountId = searchParams.get('destinationAccountId');
  const sourceAccountId = searchParams.get('sourceAccountId');

  if (!destinationAccountId) {
    throw new Error('Missing destinationAccountId search param');
  }

  const destinationAccount = useAccount(destinationAccountId);
  const sourceAccount = useAccountOrDefault(sourceAccountId);

  return (
    <TransferProvider
      sourceAccount={sourceAccount}
      destinationAccount={destinationAccount}
    >
      <Outlet />
    </TransferProvider>
  );
}
