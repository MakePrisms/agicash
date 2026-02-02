import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Page, PageContent } from '~/components/page';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { AcceptTerms } from '~/features/signup/accept-terms';
import { acceptTermsRouteGuard } from '~/features/signup/accept-terms-route';
import { useSignOut } from '~/features/user/auth';
import { useAcceptTerms } from '~/features/user/user-hooks';
import { useToast } from '~/hooks/use-toast';
import type { Route } from './+types/_protected.accept-terms';

export const unstable_clientMiddleware: Route.unstable_ClientMiddlewareFunction[] =
  [acceptTermsRouteGuard];

export async function clientLoader() {
  return {};
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

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
      setIsAccepting(false);
      console.error('Failed to accept terms', { cause: e });
      toast({
        variant: 'destructive',
        title: 'Failed to accept terms',
        description: 'Please try again',
      });
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
