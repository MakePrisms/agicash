import { verifyEmail as osVerifyEmail } from '@opensecret/react';
import { useState } from 'react';
import { redirect, unstable_createContext } from 'react-router';
import { useToast } from '~/hooks/use-toast';
import { getQueryClient } from '~/query-client';
import type { Route } from '../../routes/+types/_protected.verify-email.($code)';
import { authStateQueryKey } from '../user/auth';
import { type FullUser, shouldVerifyEmail } from '../user/user';
import { useRequestNewEmailVerificationCode } from '../user/user-hooks';
import { getUserFromCacheOrThrow } from '../user/user-hooks';

export const verifyEmailContext = unstable_createContext<FullUser>();

export const verifyEmailRouteGuard: Route.unstable_ClientMiddlewareFunction =
  async ({ request, context }, next) => {
    const user = getUserFromCacheOrThrow();

    if (!shouldVerifyEmail(user)) {
      throw getRedirectAwayFromVerifyEmail(request);
    }

    context.set(verifyEmailContext, user);

    await next();
  };

export const getRedirectAwayFromVerifyEmail = (request: Request) => {
  const location = new URL(request.url);
  const redirectTo = location.searchParams.get('redirectTo') || '/';
  // We have to use window.location.hash because location that comes from the request does not have the hash
  return redirect(`${redirectTo}${location.search}${window.location.hash}`);
};

export const verifyEmail = async (
  code: string,
): Promise<{ verified: true } | { verified: false; error: Error }> => {
  try {
    await osVerifyEmail(code);
    const queryClient = getQueryClient();
    await queryClient.invalidateQueries({
      queryKey: [authStateQueryKey],
      refetchType: 'all',
    });
    return { verified: true };
  } catch (e) {
    const error = new Error('Failed to verify email', { cause: e });
    console.error(error);
    return { verified: false, error };
  }
};

export const useRequestEmailVerificationCode = () => {
  const { toast } = useToast();
  const requestNewEmailVerificationCode = useRequestNewEmailVerificationCode();
  const [requestingEmailVerificationCode, setRequestingEmailVerificationCode] =
    useState<boolean>(false);

  const requestEmailVerificationCode = async () => {
    if (requestingEmailVerificationCode) return;

    try {
      setRequestingEmailVerificationCode(true);
      await requestNewEmailVerificationCode();
    } catch {
      toast({
        variant: 'destructive',
        title: 'Failed to send new verification email',
        description: 'Please try again or contact support',
      });
    } finally {
      setRequestingEmailVerificationCode(false);
    }
  };

  return {
    requestingEmailVerificationCode,
    requestEmailVerificationCode,
  };
};
