import { Suspense } from 'react';
import { redirect } from 'react-router';
import { Page } from '~/components/page';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { ReceiveCashuToken } from '~/features/receive';
import { ClaimAsGuestReceiveCashuToken } from '~/features/receive/receive-cashu-token';
import { extractCashuToken } from '~/lib/cashu';
import type { Route } from './+types/_protected.receive.cashu_.token';
import { ReceiveCashuTokenSkeleton } from './receive-cashu-token-skeleton';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  // Request url doesn't include hash so we need to read it from the window location instead
  const token = extractCashuToken(window.location.hash);

  if (!token) {
    throw redirect('/receive');
  }

  const location = new URL(request.url);
  const selectedAccountId =
    location.searchParams.get('selectedAccountId') ?? undefined;
  const autoClaim = location.searchParams.get('autoClaim') === 'true';

  return { token, autoClaim, selectedAccountId };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function ProtectedReceiveCashuToken({
  loaderData,
}: Route.ComponentProps) {
  const { token, autoClaim, selectedAccountId } = loaderData;

  return (
    <Page>
      {autoClaim ? (
        <ClaimAsGuestReceiveCashuToken token={token} />
      ) : (
        <>
          <Suspense fallback={<ReceiveCashuTokenSkeleton />}>
            <ReceiveCashuToken
              token={token}
              preferredReceiveAccountId={selectedAccountId}
            />
          </Suspense>
        </>
      )}
    </Page>
  );
}
