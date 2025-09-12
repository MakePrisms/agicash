import { redirect } from 'react-router';
import { Page } from '~/components/page';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { PublicReceiveCashuToken } from '~/features/receive/receive-cashu-token';
import { authQueryOptions } from '~/features/user/auth';
import { extractCashuToken } from '~/lib/cashu';
import { getQueryClient } from '~/query-client';
import type { Route } from './+types/_public.receive-cashu-token';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const location = new URL(request.url);
  // We have to use window.location.hash because location that comes from the request does not have the hash
  const hash = window.location.hash;
  const queryClient = getQueryClient();
  const { isLoggedIn } = await queryClient.ensureQueryData(authQueryOptions());

  if (isLoggedIn) {
    const currentLocation = window.location;
    // TOOD: see if it is possibe to come from that location but not want to auto claim
    const isPublicReceiveCashuToken =
      currentLocation.pathname === '/receive-cashu-token';
    const newSearch = new URLSearchParams(location.search);
    if (isPublicReceiveCashuToken) {
      newSearch.set('autoClaim', 'true');
    }
    const newSearchString =
      newSearch.size > 0 ? `?${newSearch.toString()}` : '';

    throw redirect(`/receive/cashu/token${newSearchString}${hash}`);
  }

  const token = extractCashuToken(hash);

  if (!token) {
    throw redirect('/signup');
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
