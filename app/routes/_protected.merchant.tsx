import { Outlet } from 'react-router';
import { useDefaultAccount } from '~/features/accounts/account-hooks';
import { MerchantProvider } from '~/features/merchant';

export default function MerchantLayout() {
  const defaultAccount = useDefaultAccount();

  return (
    <MerchantProvider initialAccount={defaultAccount}>
      <Outlet />
    </MerchantProvider>
  );
}
