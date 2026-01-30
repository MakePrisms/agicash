import { Outlet, useSearchParams } from 'react-router';
import { useAccountOrDefault } from '~/features/accounts/account-hooks';
import { ReceiveProvider } from '~/features/receive';

export default function ReceiveLayout() {
  const [searchParams] = useSearchParams();
  const accountId = searchParams.get('accountId');
  const initialAccount = useAccountOrDefault(accountId);

  return (
    <ReceiveProvider initialAccount={initialAccount}>
      <Outlet />
    </ReceiveProvider>
  );
}
