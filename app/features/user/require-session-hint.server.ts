import { redirect } from 'react-router';
import { sessionHintCookie } from './session-hint-cookie';

/**
 * Server loader helper: short-circuit to /home when the session hint cookie
 * is absent, preserving the current pathname as `redirectTo` so the user
 * lands back on the original page after login.
 *
 * Lives in a separate module so it doesn't share the `redirect` import with
 * the route file's clientMiddleware — see [react-router's split-route-modules
 * constraint](https://reactrouter.com/api/framework-conventions/route-module#splitting-route-modules).
 */
export const requireSessionHintOrRedirect = (request: Request): void => {
  if (sessionHintCookie.isPresent(request.headers.get('Cookie'))) {
    return;
  }

  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  if (url.pathname !== '/') {
    params.set('redirectTo', url.pathname);
  }
  const search = params.toString();
  throw redirect(`/home${search ? `?${search}` : ''}`);
};
