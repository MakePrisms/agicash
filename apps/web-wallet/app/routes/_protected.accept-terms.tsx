import { useState } from 'react';
import { redirect, useNavigate } from 'react-router';
import { Page, PageContent } from '~/components/page';
import { AcceptTerms } from '~/features/user/accept-terms';
import { useSignOut } from '~/features/user/auth';
import { shouldAcceptTerms } from '~/features/user/user';
import {
  getUserFromCacheOrThrow,
  useAcceptTerms,
} from '~/features/user/user-hooks';
import { useRedirectTo } from '~/hooks/use-redirect-to';
import { useToast } from '~/hooks/use-toast';
import type { Route } from './+types/_protected.accept-terms';

const acceptTermsRouteGuard: Route.ClientMiddlewareFunction = async (
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

export const clientMiddleware: Route.ClientMiddlewareFunction[] = [
  acceptTermsRouteGuard,
];

export default function AcceptTermsRoute() {
  const { toast } = useToast();
  const acceptTerms = useAcceptTerms();
  const { signOut, isSigningOut } = useSignOut();
  const navigate = useNavigate();
  const { redirectTo } = useRedirectTo('/');
  const [isAccepting, setIsAccepting] = useState(false);

  const handleAccept = async () => {
    setIsAccepting(true);
    try {
      await acceptTerms({ walletTerms: true });
      navigate(`${redirectTo}${window.location.hash}`);
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
          requireWalletTerms
          requireGiftCardMintTerms={false}
          onAccept={handleAccept}
          onBack={signOut}
          loading={isAccepting || isSigningOut}
        />
      </PageContent>
    </Page>
  );
}
