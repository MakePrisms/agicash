import { validateCashuToken } from '@agicash/cashu';
import type { Account, User } from '@agicash/wallet-sdk';
import { isDefaultAccount } from '@agicash/wallet-sdk';
import { decodeCashuToken } from '@agicash/wallet-sdk/temporary';
import * as Sentry from '@sentry/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { Suspense } from 'react';
import { redirect } from 'react-router';
import { Page } from '~/components/page';
import {
  AccountsCache,
  accountsQueryOptions,
} from '~/features/accounts/account-hooks';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { ReceiveCashuToken } from '~/features/receive';
import { UnsupportedCashuTokenPage } from '~/features/receive/unsupported-cashu-token-page';
import { getQueryClient } from '~/features/shared/query-client';
import { sdk } from '~/features/shared/sdk.client';
import { UserCache, getUserFromCacheOrThrow } from '~/features/user/user-hooks';
import { toast } from '~/hooks/use-toast';
import type { Route } from './+types/_protected.receive.cashu_.token';
import { ReceiveCashuTokenSkeleton } from './receive-cashu-token-skeleton';

/**
 * Sets the just-received account as the user's default when it isn't already —
 * a UI nicety so a first-time user receiving to a non-default account sees the
 * right balance on the home page. Best-effort: never fails the claim. Web-only
 * UX, so it lives here rather than in the claim service.
 */
async function trySetReceiveAccountAsDefault(
  queryClient: QueryClient,
  user: User,
  account: Account,
): Promise<void> {
  if (
    account.currency === user.defaultCurrency &&
    isDefaultAccount(user, account)
  ) {
    return;
  }
  try {
    const updatedUser = await sdk.user.setDefaultAccount({
      account,
      setDefaultCurrency: true,
    });
    new UserCache(queryClient).set(updatedUser);
  } catch (error) {
    console.error('Failed to set default account while claiming the token', {
      cause: error,
      accountId: account.id,
    });
  }
}

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
    const user = getUserFromCacheOrThrow();
    const queryClient = getQueryClient();
    const accounts = await queryClient.fetchQuery(accountsQueryOptions());

    const result = await sdk.receive.cashuToken.claim({
      token,
      claimTo,
      accounts,
      user,
    });

    if (result.success) {
      // Apply the claim's account changes to the cache so the destination
      // screen renders them immediately after the redirect.
      const accountsCache = new AccountsCache(queryClient);
      for (const account of result.changedAccounts) {
        accountsCache.upsert(account);
      }
      await trySetReceiveAccountAsDefault(
        queryClient,
        user,
        result.receiveAccount,
      );
    } else {
      toast({
        title: 'Failed to claim the token',
        description: result.message,
        variant: 'destructive',
        duration: 8000,
      });
      if (result.error) {
        Sentry.captureException(
          new Error(result.message, { cause: result.error }),
        );
      }
    }

    const explicitRedirectTo = location.searchParams.get('redirectTo');
    let redirectTo = explicitRedirectTo ?? '/';

    if (
      !explicitRedirectTo &&
      result.success &&
      result.receiveAccount.purpose === 'gift-card'
    ) {
      redirectTo = `/gift-cards/${result.receiveAccount.id}`;
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
