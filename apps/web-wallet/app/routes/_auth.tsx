import { Outlet, redirect } from 'react-router';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { getSdk } from '~/features/shared/sdk';
import type { Route } from './+types/_auth';

const routeGuardMiddleware: Route.ClientMiddlewareFunction = async (
  { request },
  next,
) => {
  const sdk = await getSdk(new URL(window.location.origin).host);
  const loggedIn = await sdk.auth.isLoggedIn();
  if (loggedIn) {
    const location = new URL(request.url);
    const redirectTo = location.searchParams.get('redirectTo') ?? '/';
    location.searchParams.delete('redirectTo');
    const newSearch =
      location.searchParams.size > 0 ? `?${location.searchParams}` : '';
    // We have to use window.location.hash because location that comes from the request does not have the hash
    throw redirect(`${redirectTo}${newSearch}${window.location.hash}`);
  }
  await next();
};

export const clientMiddleware: Route.ClientMiddlewareFunction[] = [
  routeGuardMiddleware,
];

export async function clientLoader() {
  // We are keeping this clientLoader to force client rendering for all auth routes.
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function AuthRoute() {
  return <Outlet />;
}
