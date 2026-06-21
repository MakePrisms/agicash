import { Suspense } from 'react';
import { redirect } from 'react-router';
import { Page } from '~/components/page';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { ReceiveCashuToken } from '~/features/receive';
import { UnsupportedCashuTokenPage } from '~/features/receive/unsupported-cashu-token-page';
import { decodeCashuToken } from '~/features/shared/cashu';
import { DomainError } from '~/features/shared/error';
import { toast } from '~/hooks/use-toast';
import { validateCashuToken } from '@agicash/cashu';
import { getSdk } from '~/lib/sdk';
import type { Route } from './+types/_protected.receive.cashu_.token';
import { ReceiveCashuTokenSkeleton } from './receive-cashu-token-skeleton';

const getClaimTo = (
  searchParams: URLSearchParams,
): 'cashu' | 'spark' | null => {
  const claimTo = searchParams.get('claimTo');
  if (claimTo === 'cashu' || claimTo === 'spark') {
    return claimTo;
  }
  return null;
};

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  // Request url doesn't include hash so we need to read it from the window location instead
  const token = await decodeCashuToken(window.location.hash);

  if (!token) {
    throw redirect('/receive');
  }

  const validation = validateCashuToken(token);

  if (!validation.isTokenSupported) {
    return {
      isTokenSupported: false as const,
      message: validation.message,
    };
  }

  const location = new URL(request.url);
  const selectedAccountId =
    location.searchParams.get('selectedAccountId') ?? undefined;
  const claimTo = getClaimTo(location.searchParams);

  if (claimTo) {
    const explicitRedirectTo = location.searchParams.get('redirectTo');
    let redirectTo = explicitRedirectTo ?? '/';

    try {
      // Create + best-effort complete the claim. The SDK throws DomainError on a
      // non-recoverable failure; the SDK leader finalizes anything left.
      const result = await getSdk().cashu.receive.receiveToken({
        token,
        claimTo,
      });

      if (
        !explicitRedirectTo &&
        result.destinationAccount.purpose === 'gift-card'
      ) {
        redirectTo = `/gift-cards/${result.destinationAccount.id}`;
      }
    } catch (error) {
      const description =
        error instanceof DomainError
          ? error.message
          : 'Unexpected error while claiming the token';
      if (!(error instanceof DomainError)) {
        console.error('Error claiming the token', { cause: error });
      }
      toast({
        title: 'Failed to claim the token',
        description,
        variant: 'destructive',
        duration: 8000,
      });
    }

    throw redirect(redirectTo);
  }

  return { isTokenSupported: true as const, token, selectedAccountId };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function ProtectedReceiveCashuToken({
  loaderData,
}: Route.ComponentProps) {
  if (!loaderData.isTokenSupported) {
    return <UnsupportedCashuTokenPage message={loaderData.message} />;
  }

  return (
    <Page>
      <Suspense fallback={<ReceiveCashuTokenSkeleton />}>
        <ReceiveCashuToken
          token={loaderData.token}
          preferredReceiveAccountId={loaderData.selectedAccountId}
        />
      </Suspense>
    </Page>
  );
}
