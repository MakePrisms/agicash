import { Outlet, useSearchParams } from 'react-router';
import { useAccountOrDefault } from '~/features/accounts/account-hooks';
import { BuyProvider } from '~/features/buy';

export default function BuyLayout() {
  const [searchParams] = useSearchParams();
  const accountId = searchParams.get('accountId');
  const initialAccount = useAccountOrDefault(accountId);

  return (
    <BuyProvider initialAccount={initialAccount}>
      <Outlet />
    </BuyProvider>
  );
}
