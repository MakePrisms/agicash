import { Outlet } from 'react-router';
import {
  useDefaultAccount,
  useGetAccountFromLocation,
} from '~/features/accounts/account-hooks';
import { ReceiveProvider } from '~/features/receive';

export default function ReceiveLayout() {
  const defaultAccount = useDefaultAccount();
  const specifiedAccount = useGetAccountFromLocation({ type: 'cashu' });

  return (
    <ReceiveProvider initialAccount={specifiedAccount ?? defaultAccount}>
      <Outlet />
    </ReceiveProvider>
  );
}
