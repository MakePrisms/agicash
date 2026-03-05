import type { LinksFunction } from 'react-router';
import { Outlet, useSearchParams } from 'react-router';
import { useAccountOrDefault } from '~/features/accounts/account-hooks';
import { BuyProvider } from '~/features/buy';
import { CASH_APP_LOGO_URL } from '~/features/buy/cash-app';

export const links: LinksFunction = () => [
  { rel: 'prefetch', href: CASH_APP_LOGO_URL, as: 'image' },
];

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
