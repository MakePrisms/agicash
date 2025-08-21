import { handleGoogleCallback } from '@opensecret/react';
import { redirect } from 'react-router';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { getErrorMessage } from '~/features/shared/error';
import { authStateQueryKey } from '~/features/user/auth';
import { toast } from '~/hooks/use-toast';
import { getQueryClient } from '~/query-client';
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

  const queryClient = getQueryClient();
  await queryClient.invalidateQueries({
    queryKey: [authStateQueryKey],
    refetchType: 'all',
  });

  throw redirect('/');
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function OAuthCallback() {
  return null;
}
