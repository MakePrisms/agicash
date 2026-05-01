import { Outlet, useSearchParams } from 'react-router';
import {
  AccountsCache,
  useAccountOrDefault,
} from '~/features/accounts/account-hooks';
import { GIFT_CARDS } from '~/features/gift-cards/use-discover-cards';
import { SendProvider } from '~/features/send';
import { pickSendAccount } from '~/features/send/pick-send-account';
import {
  type SendDestination,
  resolveSendDestination,
} from '~/features/send/resolve-destination';
import { getQueryClient } from '~/features/shared/query-client';
import { toast } from '~/hooks/use-toast';
import type { Route } from './+types/_protected.send';

export async function clientLoader(): Promise<{
  initialDestination: SendDestination | null;
  initialAccountId: string | null;
}> {
  const hash = window.location.hash.slice(1);
  if (!hash) {
    return { initialDestination: null, initialAccountId: null };
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
    return { initialDestination: null, initialAccountId: null };
  }

  const initialDestination = result.data;
  let initialAccountId: string | null = null;
  if (initialDestination.sendType === 'BOLT11_INVOICE') {
    const accounts = new AccountsCache(getQueryClient()).getAll() ?? [];
    const matched = pickSendAccount({
      decodedBolt11: initialDestination.decoded,
      accounts,
      giftCards: GIFT_CARDS,
    });
    initialAccountId = matched?.id ?? null;
  }

  return { initialDestination, initialAccountId };
}

clientLoader.hydrate = true as const;

export default function SendLayout({ loaderData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const accountIdParam = searchParams.get('accountId');
  const initialAccount = useAccountOrDefault(
    loaderData.initialAccountId ?? accountIdParam,
  );

  return (
    <SendProvider
      initialAccount={initialAccount}
      initialDestination={loaderData.initialDestination}
    >
      <Outlet />
    </SendProvider>
  );
}
