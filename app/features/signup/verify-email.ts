import { verifyEmail as osVerifyEmail } from '@agicash/opensecret';
import { useState } from 'react';
import { createContext, redirect } from 'react-router';
import { useToast } from '~/hooks/use-toast';
import type { Route } from '../../routes/+types/_protected.verify-email.($code)';
import { invalidateAuthQueries } from '../user/auth';
import { type FullUser, shouldVerifyEmail } from '../user/user';
import { useRequestNewEmailVerificationCode } from '../user/user-hooks';
import { getUserFromCacheOrThrow } from '../user/user-hooks';

export const verifyEmailContext = createContext<FullUser>();

export const verifyEmailRouteGuard: Route.ClientMiddlewareFunction = async (
  { request, context },
  next,
) => {
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
    await invalidateAuthQueries();
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
