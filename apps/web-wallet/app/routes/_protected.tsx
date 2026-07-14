import type { AuthUser, User } from '@agicash/wallet-sdk';
import { shouldAcceptTerms } from '@agicash/wallet-sdk';
import {
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  ensureBreezWasm,
} from '@agicash/wallet-sdk/temporary';
import type { QueryClient } from '@tanstack/react-query';
import { Outlet, redirect } from 'react-router';
import { AccountsCache } from '~/features/accounts/account-hooks';
import { supabaseSessionTokenQuery } from '~/features/agicash-db/supabase-session';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import {
  seedQueryOptions,
  xpubQueryOptions,
} from '~/features/shared/cashu-query-options';
import {
  encryptionPrivateKeyQueryOptions,
  encryptionPublicKeyQueryOptions,
} from '~/features/shared/encryption-hooks';
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

const hasUserChanged = (user: User, authUser: AuthUser) => {
  const currentAuthUserEmail = authUser.email ?? null;
  const currentUserEmail = user.isGuest ? null : user.email;

  return (
    currentUserEmail !== currentAuthUserEmail ||
    user.emailVerified !== authUser.email_verified
  );
};

const ensureUserData = async (
  queryClient: QueryClient,
  authUser: AuthUser,
  termsAcceptedAt?: string,
  giftCardMintTermsAcceptedAt?: string,
): Promise<User> => {
  let user = getUserFromCache(queryClient);

  if (!user) {
    queryClient.prefetchQuery(supabaseSessionTokenQuery());
  }

  if (!user || hasUserChanged(user, authUser)) {
    // The SDK derives its own key copies (session-keys memos); these warms keep
    // the web-side entries the unmigrated receive/send/claim repos read
    // populated — and failing — in the middleware rather than at first Wallet
    // render, as on master. Transitional double derivation until those domains
    // migrate into the SDK (steps 8–16).
    const [{ user: upsertedUser, accounts }] = await Promise.all([
      sdk.user.ensure({
        termsAcceptedAt,
        giftCardMintTermsAcceptedAt,
      }),
      queryClient.ensureQueryData(encryptionPrivateKeyQueryOptions()),
      queryClient.ensureQueryData(encryptionPublicKeyQueryOptions()),
      queryClient.ensureQueryData(
        xpubQueryOptions({
          queryClient,
          derivationPath: BASE_CASHU_LOCKING_DERIVATION_PATH,
        }),
      ),
      queryClient.ensureQueryData(sparkMnemonicQueryOptions()),
      queryClient.ensureQueryData(seedQueryOptions()),
    ]);
    user = upsertedUser;
    queryClient.setQueryData([UserCache.Key], user);
    queryClient.setQueryData([AccountsCache.Key], accounts);
  }

  return user;
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

  const pendingTermsAcceptedAt = pendingWalletTermsStorage.get();
  if (pendingTermsAcceptedAt) {
    pendingWalletTermsStorage.remove();
  }

  const pendingGiftCardMintTermsAcceptedAt =
    pendingGiftCardMintTermsStorage.get();
  if (pendingGiftCardMintTermsAcceptedAt) {
    pendingGiftCardMintTermsStorage.remove();
  }

  // ensureUserData derives the Spark identity public key via defaultExternalSigner(),
  // which requires WASM to be initialized. Shared with entry.client.tsx so the init
  // is typically already in-flight (or complete) by the time we await here.
  await ensureBreezWasm();
  const user = await ensureUserData(
    queryClient,
    authUser,
    pendingTermsAcceptedAt,
    pendingGiftCardMintTermsAcceptedAt,
  );

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
