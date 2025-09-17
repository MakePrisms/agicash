import { Suspense } from 'react';
import { redirect } from 'react-router';
import { Page } from '~/components/page';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { ReceiveCashuToken } from '~/features/receive';
import { sharableCashuTokenSchema } from '~/features/shared/cashu';
import { parseHashParams } from '~/lib/utils';
import type { Route } from './+types/_protected.receive.cashu_.token';
import { ReceiveCashuTokenSkeleton } from './receive-cashu-token-skeleton';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  // Request url doesn't include hash so we need to read it from the window location instead
  const hash = window.location.hash;
  const hashParams = parseHashParams(hash, sharableCashuTokenSchema);

  if (!hashParams) {
    throw redirect('/receive');
  }

  const location = new URL(request.url);
  const selectedAccountId =
    location.searchParams.get('selectedAccountId') ?? undefined;
  const autoClaim = location.searchParams.get('autoClaim') === 'true';

  return {
    token: hashParams.token,
    autoClaim,
    selectedAccountId,
    unlockingKey: hashParams.unlockingKey,
  };
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
