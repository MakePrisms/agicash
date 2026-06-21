import { Outlet, redirect } from 'react-router';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { getQueryClient } from '~/features/shared/query-client';
import {
  type AuthUser,
  authQueryOptions,
  useAuthState,
} from '~/features/user/auth';
import {
  pendingGiftCardMintTermsStorage,
  pendingWalletTermsStorage,
} from '~/features/user/pending-terms-storage';
import { requireSessionHintOrRedirect } from '~/features/user/require-session-hint.server';
import { shouldAcceptTerms } from '~/features/user/user';
import { Wallet } from '~/features/wallet/wallet';
import { initSdk } from '~/lib/sdk';
import { ensureBreezWasm } from '~/lib/spark';
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

  // Resolve the stateless SDK before the rest of the layout runs: it owns the
  // user row + default accounts (upserted at sign-in via auth.ensureUser) and is
  // the source for the user identity below, plus child-route loaders
  // (verify-email) read getSdk(). The domain is the request host, matching the
  // root loader's canonical-origin host for these non-prerendered routes.
  // Breez WASM init overlaps; both are idempotent and typically already in-flight.
  const [sdk] = await Promise.all([initSdk(location.host), ensureBreezWasm()]);

  const pendingTermsAcceptedAt = pendingWalletTermsStorage.get();
  if (pendingTermsAcceptedAt) {
    pendingWalletTermsStorage.remove();
  }

  const pendingGiftCardMintTermsAcceptedAt =
    pendingGiftCardMintTermsStorage.get();
  if (pendingGiftCardMintTermsAcceptedAt) {
    pendingGiftCardMintTermsStorage.remove();
  }

  let user = await sdk.user.get();
  if (!user) {
    throw redirect(`/home${location.search}${hash}`);
  }

  // The SDK's sign-in ensureUser does not carry the pending terms captured during
  // signup/token-receive, so apply them here on first protected load to avoid
  // re-prompting the accept-terms screen for a user who already accepted.
  if (pendingTermsAcceptedAt || pendingGiftCardMintTermsAcceptedAt) {
    user = await sdk.user.acceptTerms({
      walletTerms: !!pendingTermsAcceptedAt,
      giftCardTerms: !!pendingGiftCardMintTermsAcceptedAt,
    });
  }

  // Prime the user store synchronously so the child route guards
  // (accept-terms / verify-email) — which run in this middleware chain BEFORE
  // any component renders — can read it via getUserFromCacheOrThrow()
  // (sdk.user.current.get()). The render path self-seeds via
  // useStoreSelect → toPromise(); this covers the pre-render guard reads.
  sdk.user.current.set(() => user);

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
