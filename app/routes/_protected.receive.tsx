import { Outlet } from 'react-router';
import {
  useAccounts,
  useDefaultAccount,
} from '~/features/accounts/account-hooks';
import { ReceiveProvider } from '~/features/receive';
import type { Route } from './+types/_protected.receive';

export function clientLoader({ request }: Route.ClientLoaderArgs) {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('accountId');
  return { accountId };
}

export default function ReceiveLayout({ loaderData }: Route.ComponentProps) {
  const { accountId } = loaderData;
  const { data: accounts } = useAccounts();
  const defaultAccount = useDefaultAccount();

  const initialAccount = accountId
    ? (accounts.find((a) => a.id === accountId) ?? defaultAccount)
    : defaultAccount;

  return (
    <ReceiveProvider initialAccount={initialAccount}>
      <Outlet />
    </ReceiveProvider>
  );
}
