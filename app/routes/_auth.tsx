import { Outlet, redirect } from 'react-router';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { authQueryOptions } from '~/features/user/auth';
import { getQueryClient } from '~/query-client';
import type { Route } from './+types/_auth';

const routeGuardMiddleware: Route.unstable_ClientMiddlewareFunction = async (
  { request },
  next,
) => {
  const location = new URL(request.url);
  const queryClient = getQueryClient();
  const { isLoggedIn, user } = await queryClient.ensureQueryData(
    authQueryOptions(),
  );

  console.debug('Rendering auth layout', {
    time: new Date().toISOString(),
    location: location.pathname,
    isLoggedIn,
    user,
  });

  if (isLoggedIn) {
    const redirectTo = location.searchParams.get('redirectTo') ?? '/';
    location.searchParams.delete('redirectTo');
    const newSearch = `?${location.searchParams.toString()}`;

    // We have to use window.location.hash because location that comes from the request does not have the hash
    throw redirect(`${redirectTo}${newSearch}${window.location.hash}`);
  }

  await next();
};

export const unstable_clientMiddleware: Route.unstable_ClientMiddlewareFunction[] =
  [routeGuardMiddleware];

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
