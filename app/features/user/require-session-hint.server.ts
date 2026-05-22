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
  // Only redirect on top-level document navigations (typed URL, refresh,
  // link from an external page). Client-side navigations within the SPA
  // come in as single-fetch data requests, and the existing
  // clientMiddleware validates the JWT against localStorage on those — so
  // letting them pass here is correct and also prevents trapping users
  // whose cookies don't persist (e.g. cookies disabled, evicted from
  // storage, manually cleared). Sec-Fetch-Mode is sent by all modern
  // browsers; if it's absent we treat the request as non-navigation to
  // avoid trapping older browsers in a redirect loop.
  if (request.headers.get('Sec-Fetch-Mode') !== 'navigate') {
    return;
  }
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
