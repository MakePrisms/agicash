import { redirect } from 'react-router';
import type { Route } from '../../routes/+types/_protected.accept-terms';
import { shouldAcceptTerms } from '../user/user';
import { getUserFromCacheOrThrow } from '../user/user-hooks';

export const acceptTermsRouteGuard: Route.unstable_ClientMiddlewareFunction =
  async ({ request }, next) => {
    const user = getUserFromCacheOrThrow();

    if (!shouldAcceptTerms(user)) {
      throw getRedirectAwayFromAcceptTerms(request);
    }

    await next();
  };

export const getRedirectAwayFromAcceptTerms = (request: Request) => {
  const location = new URL(request.url);
  const redirectTo = location.searchParams.get('redirectTo') || '/';
  // We have to use window.location.hash because location that comes from the request does not have the hash
  return redirect(`${redirectTo}${window.location.hash}`);
};
