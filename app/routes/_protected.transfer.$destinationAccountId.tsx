import { Outlet, useSearchParams } from 'react-router';
import {
  useAccount,
  useAccountOrDefault,
} from '~/features/accounts/account-hooks';
import { TransferProvider } from '~/features/transfer/transfer-provider';
import type { Route } from './+types/_protected.transfer.$destinationAccountId';

export default function TransferLayout({ params }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const sourceAccountId = searchParams.get('sourceAccountId');

  const destinationAccount = useAccount(params.destinationAccountId);
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
