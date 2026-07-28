import type { AuthUser } from '@agicash/wallet-sdk';
import { shouldAcceptTerms } from '@agicash/wallet-sdk';
import { ensureBreezWasm } from '@agicash/wallet-sdk/temporary';
import { Outlet, redirect } from 'react-router';
import { supabaseSessionTokenQuery } from '~/features/agicash-db/supabase-session';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { seedQueryOptions } from '~/features/shared/cashu-query-options';
import { encryptionQueryOptions } from '~/features/shared/encryption-hooks';
import { getQueryClient } from '~/features/shared/query-client';
import { sdk } from '~/features/shared/sdk.client';
import { sparkMnemonicQueryOptions } from '~/features/shared/spark-query-options';
import { authQueryOptions, useAuthState } from '~/features/user/auth';
import {
  pendingGiftCardMintTermsStorage,
  pendingWalletTermsStorage,
} from '~/features/user/pending-terms-storage';
import { requireSessionHintOrRedirect } from '~/features/user/require-session-hint.server';
import { UserCache, getUserFromCache } from '~/features/user/user-hooks';
import { Wallet } from '~/features/wallet/wallet';
import type { Route } from './+types/_protected';

const shouldUserVerifyEmail = (user: AuthUser) => {
  const isGuest = !user.email;
  return !isGuest && !user.email_verified;
};

const buildRedirectWithReturnUrl = (
  destinationRoute: string,
  location: URL,
  hash: string,
) => {
  const searchParams = new URLSearchParams(location.search);
  if (location.pathname !== '/') {
    searchParams.set('redirectTo', location.pathname);
  }
  const search = `?${searchParams.toString()}`;
  return redirect(`${destinationRoute}${search}${hash}`);
};

const routeGuardMiddleware: Route.ClientMiddlewareFunction = async (
  { request },
  next,
) => {
  const location = new URL(request.url);
  // We have to use window.location.hash because location that comes from the request does not have the hash
  const hash = window.location.hash;
  const queryClient = getQueryClient();
  const { isLoggedIn, user: authUser } = await queryClient.ensureQueryData(
    authQueryOptions(),
  );
  const shouldRedirectToSignup = !isLoggedIn;
  const shouldVerifyEmail = authUser ? shouldUserVerifyEmail(authUser) : false;
  const isAcceptTermsRoute = location.pathname.startsWith('/accept-terms');
  const isVerifyEmailRoute = location.pathname.startsWith('/verify-email');
  const shouldRedirectToVerifyEmail =
    shouldVerifyEmail && !isVerifyEmailRoute && !isAcceptTermsRoute;

  console.debug('Rendering protected layout', {
    time: new Date().toISOString(),
    location: location.pathname,
    isLoggedIn,
    shouldRedirectToSignup,
    userId: authUser?.id,
    shouldVerifyEmail,
    isAcceptTermsRoute,
    isVerifyEmailRoute,
    shouldRedirectToVerifyEmail,
  });

  if (shouldRedirectToSignup) {
    let search = location.search;
    if (location.pathname !== '/') {
      const searchParams = new URLSearchParams(location.search);
      searchParams.set('redirectTo', location.pathname);
      search = `?${searchParams.toString()}`;
    }

    throw redirect(`/home${search}${hash}`);
  }

  // TEMPORARY: these prefetches populate cache entries that receive/send/claim
  // repositories not yet migrated into the SDK still read (session token,
  // encryption, seed, spark mnemonic); each is deleted when its feature migrates
  // into the SDK. ensureBreezWasm first: the spark mnemonic prefetch derives the
  // Spark identity via defaultExternalSigner(), which requires WASM. Shared with
  // entry.client.tsx so the init is typically already in-flight here.
  await ensureBreezWasm();
  queryClient.prefetchQuery(supabaseSessionTokenQuery());
  await Promise.all([
    queryClient.ensureQueryData(encryptionQueryOptions()),
    queryClient.ensureQueryData(sparkMnemonicQueryOptions()),
    queryClient.ensureQueryData(seedQueryOptions()),
  ]);

  // The provisioned user and accounts arrive via the SDK's auth.session-started
  // event (seeded into cache at boot). Replay any terms accepted before this
  // session existed, then gate on the result.
  const pendingTermsAcceptedAt = pendingWalletTermsStorage.get();
  if (pendingTermsAcceptedAt) {
    pendingWalletTermsStorage.remove();
  }

  const pendingGiftCardMintTermsAcceptedAt =
    pendingGiftCardMintTermsStorage.get();
  if (pendingGiftCardMintTermsAcceptedAt) {
    pendingGiftCardMintTermsStorage.remove();
  }

  let user = getUserFromCache(queryClient) ?? (await sdk.user.get());
  if (pendingTermsAcceptedAt || pendingGiftCardMintTermsAcceptedAt) {
    user = await sdk.user.acceptTerms({
      walletTermsAcceptedAt: pendingTermsAcceptedAt,
      giftCardMintTermsAcceptedAt: pendingGiftCardMintTermsAcceptedAt,
    });
    queryClient.setQueryData([UserCache.Key], user);
  }

  const shouldRedirectToAcceptTerms =
    shouldAcceptTerms(user) && !isAcceptTermsRoute;

  if (shouldRedirectToAcceptTerms) {
    throw buildRedirectWithReturnUrl('/accept-terms', location, hash);
  }

  if (shouldRedirectToVerifyEmail) {
    throw buildRedirectWithReturnUrl('/verify-email', location, hash);
  }

  await next();
};

export const clientMiddleware: Route.ClientMiddlewareFunction[] = [
  routeGuardMiddleware,
];

// Cookie is a hint, not auth: clientMiddleware above still validates the JWT,
// so a forged cookie just buys a brief loading screen. The win is the common
// unauthenticated path — 302 before any HTML is sent, so no flicker on the
// way to /home.
export async function loader({ request }: Route.LoaderArgs) {
  requireSessionHintOrRedirect(request);
  return null;
}

export async function clientLoader() {
  // We are keeping this clientLoader to force client rendering for all protected routes.
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function ProtectedRoute() {
  const { user } = useAuthState();

  if (!user) {
    console.debug('Logging out...');
    return null;
  }

  return (
    <Wallet>
      <Outlet />
    </Wallet>
  );
}
