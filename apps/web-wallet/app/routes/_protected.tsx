import { Outlet, redirect } from 'react-router';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { getSdk } from '~/features/shared/sdk';
import { useAuthState } from '~/features/user/auth';
import { requireSessionHintOrRedirect } from '~/features/user/require-session-hint.server';
import { shouldAcceptTerms, shouldVerifyEmail } from '~/features/user/user';
import { Wallet } from '~/features/wallet/wallet';
import type { Route } from './+types/_protected';

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
  const sdk = await getSdk(new URL(window.location.origin).host);

  if (!(await sdk.auth.isLoggedIn())) {
    let search = location.search;
    if (location.pathname !== '/') {
      const searchParams = new URLSearchParams(location.search);
      searchParams.set('redirectTo', location.pathname);
      search = `?${searchParams.toString()}`;
    }

    throw redirect(`/home${search}${hash}`);
  }

  // getCurrentUser -> resolveSession bootstraps the wallet.users row on
  // missing/drift internally (derives keys + default accounts + upsert).
  const user = await sdk.user.getCurrentUser();
  if (!user) {
    // token present but the server rejected it mid-resolve -> treat as logged out
    throw redirect('/home');
  }

  const isAcceptTermsRoute = location.pathname.startsWith('/accept-terms');
  const isVerifyEmailRoute = location.pathname.startsWith('/verify-email');

  if (shouldAcceptTerms(user) && !isAcceptTermsRoute) {
    throw buildRedirectWithReturnUrl('/accept-terms', location, hash);
  }

  if (shouldVerifyEmail(user) && !isVerifyEmailRoute && !isAcceptTermsRoute) {
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
