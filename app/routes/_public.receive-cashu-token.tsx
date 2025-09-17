import { redirect } from 'react-router';
import { Page } from '~/components/page';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { PublicReceiveCashuToken } from '~/features/receive/receive-cashu-token';
import { sharableCashuTokenSchema } from '~/features/shared/cashu';
import { authQuery } from '~/features/user/auth';
import { parseHashParams } from '~/lib/utils';
import { getQueryClient } from '~/query-client';
import type { Route } from './+types/_public.receive-cashu-token';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const location = new URL(request.url);
  // We have to use window.location.hash because location that comes from the request does not have the hash
  const hash = window.location.hash;
  const hashParams = parseHashParams(hash, sharableCashuTokenSchema);
  if (!hashParams) {
    throw redirect('/signup');
  }

  const queryClient = getQueryClient();
  const { isLoggedIn } = await queryClient.ensureQueryData(authQuery());

  if (isLoggedIn) {
    throw redirect(`/receive/cashu/token${location.search}${hash}`);
  }

  return { token: hashParams.token, unlockingKey: hashParams.unlockingKey };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function ReceiveCashuTokenPage({
  loaderData,
}: Route.ComponentProps) {
  const { token, unlockingKey } = loaderData;

  return (
    <Page>
      <PublicReceiveCashuToken token={token} unlockingKey={unlockingKey} />
    </Page>
  );
}
