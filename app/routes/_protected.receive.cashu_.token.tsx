import { Suspense } from 'react';
import { redirect } from 'react-router';
import { Page } from '~/components/page';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { ReceiveCashuToken } from '~/features/receive';
import { extractCashuToken } from '~/lib/cashu';
import type { Route } from './+types/_protected.receive.cashu_.token';
import { ReceiveCashuTokenSkeleton } from './receive-cashu-token-skeleton';

function parseHashParams(hash: string): URLSearchParams | null {
  const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;

  // Only parse as params if it contains = (parameter format)
  if (!cleaned.includes('=')) {
    return null;
  }

  return new URLSearchParams(cleaned);
}

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  // Request url doesn't include hash so we need to read it from the window location instead
  const hash = window.location.hash;
  const hashParams = parseHashParams(hash);

  const token = extractCashuToken(hash);

  if (!token) {
    throw redirect('/receive');
  }

  const location = new URL(request.url);
  const selectedAccountId =
    location.searchParams.get('selectedAccountId') ?? undefined;
  const autoClaim = location.searchParams.get('autoClaim') === 'true';
  const unlockingKey = hashParams?.get('unlockingKey');

  return { token, autoClaim, selectedAccountId, unlockingKey };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function ProtectedReceiveCashuToken({
  loaderData,
}: Route.ComponentProps) {
  const { token, autoClaim, selectedAccountId, unlockingKey } = loaderData;

  return (
    <Page>
      <Suspense fallback={<ReceiveCashuTokenSkeleton />}>
        <ReceiveCashuToken
          token={token}
          unlockingKey={unlockingKey}
          autoClaimToken={autoClaim}
          preferredReceiveAccountId={selectedAccountId}
        />
      </Suspense>
    </Page>
  );
}
