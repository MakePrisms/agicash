import { Outlet, useSearchParams } from 'react-router';
import { useAccountOrDefault } from '~/features/accounts/account-hooks';
import { SendProvider } from '~/features/send';
import {
  type SendDestination,
  resolveSendDestination,
} from '~/features/send/resolve-destination';
import { toast } from '~/hooks/use-toast';
import type { Route } from './+types/_protected.send';

export async function clientLoader(): Promise<{
  initialDestination: SendDestination | null;
}> {
  const hash = window.location.hash.slice(1);
  if (!hash) {
    return { initialDestination: null };
  }

  // Strip the hash from the URL after reading it so refreshes / back-navigation
  // don't re-apply the destination.
  window.history.replaceState(
    null,
    '',
    window.location.pathname + window.location.search,
  );

  const result = await resolveSendDestination(hash, {
    allowZeroAmountBolt11: true,
  });

  if (!result.success) {
    toast({
      title: 'Invalid destination',
      description: result.error,
      variant: 'destructive',
      duration: 8000,
    });
    return { initialDestination: null };
  }

  return { initialDestination: result.data };
}

clientLoader.hydrate = true as const;

export default function SendLayout({ loaderData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const accountId = searchParams.get('accountId');
  const initialAccount = useAccountOrDefault(accountId);

  return (
    <SendProvider
      initialAccount={initialAccount}
      initialDestination={loaderData.initialDestination}
    >
      <Outlet />
    </SendProvider>
  );
}
