import type { LinksFunction } from 'react-router';
import { Outlet, useSearchParams } from 'react-router';
import { useAccountOrDefault } from '~/features/accounts/account-hooks';
import {
  CASH_APP_LOGO_BLACK,
  CASH_APP_LOGO_WHITE,
} from '~/features/buy/cash-app';
import { ReceiveProvider } from '~/features/receive';

export const links: LinksFunction = () => [
  { rel: 'prefetch', href: CASH_APP_LOGO_WHITE, as: 'image' },
  { rel: 'prefetch', href: CASH_APP_LOGO_BLACK, as: 'image' },
];

export default function BuyLayout() {
  const [searchParams] = useSearchParams();
  const accountId = searchParams.get('accountId');
  const initialAccount = useAccountOrDefault(accountId);

  return (
    <ReceiveProvider initialAccount={initialAccount}>
      <Outlet />
    </ReceiveProvider>
  );
}
