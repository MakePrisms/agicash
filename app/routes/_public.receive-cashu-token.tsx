import { redirect } from 'react-router';
import { Page } from '~/components/page';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { PublicReceiveCashuToken } from '~/features/receive/receive-cashu-token';
import { getQueryClient } from '~/features/shared/query-client';
import { authQueryOptions } from '~/features/user/auth';
import { extractCashuToken } from '~/lib/cashu';
import type { Route } from './+types/_public.receive-cashu-token';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const location = new URL(request.url);
  // We have to use window.location.hash because location that comes from the request does not have the hash
  const hash = window.location.hash;
  const queryClient = getQueryClient();
  const { isLoggedIn } = await queryClient.ensureQueryData(authQueryOptions());

  if (isLoggedIn) {
    // We have to use window.location.search because when this loader is revalidated after signin as guest,
    // request.url will be the same as before the signin.
    throw redirect(`/receive/cashu/token${location.search}${hash}`);
  }

  const token = extractCashuToken(hash);

  if (!token) {
    throw redirect('/home');
  }

  return { token };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function ReceiveCashuTokenPage({
  loaderData,
}: Route.ComponentProps) {
  const { token } = loaderData;

  return (
    <Page>
      <PublicReceiveCashuToken token={token} />
    </Page>
  );
}
