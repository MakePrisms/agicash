import { Outlet, useSearchParams } from 'react-router';
import { useAccountOrDefault } from '~/features/accounts/account-hooks';
import { BuyProvider } from '~/features/buy';
import { requireWalletOperations } from '~/features/shared/wallet-operations';
import type { Route } from './+types/_protected.buy';

export const clientMiddleware: Route.ClientMiddlewareFunction[] = [
  requireWalletOperations,
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
