import { Outlet, useSearchParams } from 'react-router';
import { useAccountOrDefault } from '~/features/accounts/account-hooks';
import { SendProvider } from '~/features/send';

export default function SendLayout() {
  const [searchParams] = useSearchParams();
  const accountId = searchParams.get('accountId');
  const initialAccount = useAccountOrDefault(accountId);

  return (
    <SendProvider initialAccount={initialAccount}>
      <Outlet />
    </SendProvider>
  );
}
