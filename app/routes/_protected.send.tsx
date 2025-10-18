import { Outlet } from 'react-router';
import {
  useDefaultAccount,
  useGetAccountFromLocation,
} from '~/features/accounts/account-hooks';
import { SendProvider } from '~/features/send';

export default function SendLayout() {
  const defaultAccount = useDefaultAccount();
  const specifiedAccount = useGetAccountFromLocation({ type: 'cashu' });

  return (
    <SendProvider initialAccount={specifiedAccount ?? defaultAccount}>
      <Outlet />
    </SendProvider>
  );
}
