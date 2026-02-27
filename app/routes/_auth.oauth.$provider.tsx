import { handleGoogleCallback } from '@opensecret/react';
import { decodeURLSafe } from '@stablelib/base64';
import { redirect } from 'react-router';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { getErrorMessage } from '~/features/shared/error';
import { invalidateAuthQueries } from '~/features/user/auth';
import { oauthLoginSessionStorage } from '~/features/user/oauth-login-session-storage';
import { toast } from '~/hooks/use-toast';
import type { Route } from './+types/_auth.oauth.$provider';

class UnsupportedOAuthProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedOAuthProviderError';
  }
}

export async function clientLoader({
  request,
  params: { provider },
}: Route.ClientLoaderArgs) {
  const location = new URL(request.url);
  const code = location.searchParams.get('code');
  const state = location.searchParams.get('state');

  if (!code || !state) {
    const message = 'Missing code or state parameter';
    console.warn(message);
    toast({
      title: 'Login failed',
      description: message,
      variant: 'destructive',
      duration: 8000,
    });
    throw redirect('/login');
  }

  try {
    switch (provider) {
      case 'google':
        await handleGoogleCallback(code, state, '');
        break;
      default: {
        throw new UnsupportedOAuthProviderError(
          `Unsupported OAuth provider: ${provider}`,
        );
      }
    }
  } catch (error) {
    if (error instanceof UnsupportedOAuthProviderError) {
      console.warn(error.message);
    } else {
      console.error('OAuth callback error', { cause: error });
    }

    toast({
      title: 'Login failed',
      description: getErrorMessage(error),
      variant: 'destructive',
      duration: 8000,
    });
    throw redirect('/login');
  }

  await invalidateAuthQueries();

  const stateValue = JSON.parse(new TextDecoder().decode(decodeURLSafe(state)));
  const oauthLoginSession = oauthLoginSessionStorage.get(
    stateValue.sessionId ?? '',
  );

  if (!oauthLoginSession) {
    throw redirect('/');
  }

  const searchParams = new URLSearchParams(oauthLoginSession.search);
  const redirectTo = searchParams.get('redirectTo') ?? '/';
  searchParams.delete('redirectTo');
  const url = `${redirectTo}${searchParams.toString()}${oauthLoginSession.hash}`;

  oauthLoginSessionStorage.remove(oauthLoginSession.sessionId);

  // The hash needs to be set manually before navigating or clientLoader of the destination route won't see it
  // See https://github.com/remix-run/remix/discussions/10721
  window.history.replaceState(null, '', oauthLoginSession.hash);
  throw redirect(url);
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function OAuthCallback() {
  return null;
}
