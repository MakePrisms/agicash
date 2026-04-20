import { useState } from 'react';
import { redirect, useNavigate, useSearchParams } from 'react-router';
import { Page, PageContent } from '~/components/page';
import { AcceptTerms } from '~/features/user/accept-terms';
import { useSignOut } from '~/features/user/auth';
import {
  shouldAcceptGiftCardMintTerms,
  shouldAcceptTerms,
} from '~/features/user/user';
import {
  getUserFromCacheOrThrow,
  useUpdateUser,
  useUser,
} from '~/features/user/user-hooks';
import type { UpdateUser } from '~/features/user/user-repository';
import { useToast } from '~/hooks/use-toast';
import type { Route } from './+types/_protected.accept-terms';

const acceptTermsRouteGuard: Route.ClientMiddlewareFunction = async (
  { request },
  next,
) => {
  const user = getUserFromCacheOrThrow();
  const location = new URL(request.url);
  const requireGiftCardMintTerms =
    location.searchParams.get('requireGiftCardMintTerms') === 'true';

  const userMustAcceptWalletTerms = shouldAcceptTerms(user);
  const userMustAcceptGiftCardMintTerms =
    requireGiftCardMintTerms && shouldAcceptGiftCardMintTerms(user);

  if (!userMustAcceptWalletTerms && !userMustAcceptGiftCardMintTerms) {
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
  const user = useUser();
  const { mutateAsync: updateUser } = useUpdateUser();
  const { signOut, isSigningOut } = useSignOut();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isAccepting, setIsAccepting] = useState(false);

  const requireGiftCardMintTerms =
    searchParams.get('requireGiftCardMintTerms') === 'true';
  const userMustAcceptWalletTerms = shouldAcceptTerms(user);
  const userMustAcceptGiftCardMintTerms =
    requireGiftCardMintTerms && shouldAcceptGiftCardMintTerms(user);

  const handleAccept = async () => {
    setIsAccepting(true);
    try {
      const now = new Date().toISOString();
      const updates: UpdateUser = {};
      if (userMustAcceptWalletTerms) updates.termsAcceptedAt = now;
      if (userMustAcceptGiftCardMintTerms) {
        updates.giftCardMintTermsAcceptedAt = now;
      }
      await updateUser(updates);
      const redirectTo = searchParams.get('redirectTo') || '/';
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
          requireWalletTerms={userMustAcceptWalletTerms}
          requireGiftCardMintTerms={userMustAcceptGiftCardMintTerms}
          onAccept={handleAccept}
          // The wallet-terms gate fires for users who arrived here without
          // going through the signup form (primarily new users from Google
          // OAuth login). They have no meaningful "back" — layout middleware
          // would just loop them — so Back signs them out.
          onBack={userMustAcceptWalletTerms ? signOut : () => navigate(-1)}
          loading={isAccepting || isSigningOut}
        />
      </PageContent>
    </Page>
  );
}
