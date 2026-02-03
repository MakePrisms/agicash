import { useState } from 'react';
import { redirect, useNavigate } from 'react-router';
import { Page, PageContent } from '~/components/page';
import { AcceptTerms } from '~/features/signup/accept-terms';
import { useSignOut } from '~/features/user/auth';
import { shouldAcceptTerms } from '~/features/user/user';
import {
  getUserFromCacheOrThrow,
  useAcceptTerms,
} from '~/features/user/user-hooks';
import { useToast } from '~/hooks/use-toast';
import type { Route } from './+types/_protected.accept-terms';

const acceptTermsRouteGuard: Route.unstable_ClientMiddlewareFunction = async (
  { request },
  next,
) => {
  const user = getUserFromCacheOrThrow();

  if (!shouldAcceptTerms(user)) {
    const location = new URL(request.url);
    const redirectTo = location.searchParams.get('redirectTo') || '/';
    throw redirect(`${redirectTo}${window.location.hash}`);
  }

  await next();
};

export const unstable_clientMiddleware: Route.unstable_ClientMiddlewareFunction[] =
  [acceptTermsRouteGuard];

export default function AcceptTermsRoute() {
  const { toast } = useToast();
  const acceptTerms = useAcceptTerms();
  const { signOut, isSigningOut } = useSignOut();
  const navigate = useNavigate();
  const [isAccepting, setIsAccepting] = useState(false);

  const handleAccept = async () => {
    setIsAccepting(true);
    try {
      await acceptTerms();
      // Navigate to the originally intended destination, preserving hash
      const searchParams = new URLSearchParams(window.location.search);
      const redirectTo = searchParams.get('redirectTo') || '/';
      const hash = window.location.hash;
      navigate(`${redirectTo}${hash}`);
    } catch (e) {
      console.error('Failed to accept terms', { cause: e });
      toast({
        variant: 'destructive',
        title: 'Failed to accept terms',
        description: 'Please try again',
      });
    } finally {
      setIsAccepting(false);
    }
  };

  return (
    <Page>
      <PageContent className="justify-center">
        <AcceptTerms
          onAccept={handleAccept}
          onBack={signOut}
          loading={isAccepting || isSigningOut}
        />
      </PageContent>
    </Page>
  );
}
