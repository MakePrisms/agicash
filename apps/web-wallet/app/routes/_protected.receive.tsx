import { Outlet, useSearchParams } from 'react-router';
import { useAccountOrDefault } from '~/features/accounts/account-hooks';
import { ReceiveProvider } from '~/features/receive';
import { requireWalletOperations } from '~/features/shared/wallet-operations';
import type { Route } from './+types/_protected.receive';

export const clientMiddleware: Route.ClientMiddlewareFunction[] = [
  requireWalletOperations,
];

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
