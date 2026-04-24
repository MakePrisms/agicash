import { Outlet, useSearchParams } from 'react-router';
import {
  useAccountOrDefault,
  useAccounts,
  useDefaultAccount,
} from '~/features/accounts/account-hooks';
import { type SendInput, classifyInput, isSendInput } from '~/features/scan';
import { SendProvider } from '~/features/send';
import { validateBolt11 } from '~/features/send/destination-validators';
import { selectSourceAccountForBolt11 } from '~/features/send/smart-source-selection';
import { useExchangeRate } from '~/hooks/use-exchange-rate';
import { toast } from '~/hooks/use-toast';
import type { Route } from './+types/_protected.send';

export async function clientLoader(): Promise<{
  initialDestination: SendInput | null;
}> {
  const hash = window.location.hash.slice(1);
  if (!hash) return { initialDestination: null };

  // The hash needs to be set manually before navigating or clientLoader of the destination route won't see it
  // See https://github.com/remix-run/remix/discussions/10721
  window.history.replaceState(
    null,
    '',
    window.location.pathname + window.location.search,
  );

  const classified = classifyInput(hash);

  if (!isSendInput(classified)) {
    return { initialDestination: null };
  }

  if (classified.type === 'bolt11') {
    const result = validateBolt11(classified.decoded, {
      allowZeroAmount: true,
    });
    if (!result.valid) {
      toast({
        title: 'Invalid invoice',
        description: result.error,
        variant: 'destructive',
        duration: 8000,
      });
      return { initialDestination: null };
    }
  }

  return {
    initialDestination: classified,
  };
}

clientLoader.hydrate = true as const;

export default function SendLayout({ loaderData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const accountId = searchParams.get('accountId');
  const accountFromUrl = useAccountOrDefault(accountId);
  const defaultAccount = useDefaultAccount();
  const { data: cashuAccounts } = useAccounts<'cashu'>({ type: 'cashu' });
  const { data: btcToUsdRate } = useExchangeRate('BTC-USD');

  const { initialDestination } = loaderData;
  const shouldRunSmartSelection =
    !accountId && initialDestination?.type === 'bolt11';

  const initialAccount = shouldRunSmartSelection
    ? selectSourceAccountForBolt11({
        decoded: initialDestination.decoded,
        accounts: cashuAccounts,
        defaultAccount,
        btcToUsdRate,
      })
    : accountFromUrl;

  return (
    <SendProvider
      initialAccount={initialAccount}
      initialDestination={initialDestination}
    >
      <Outlet />
    </SendProvider>
  );
}
