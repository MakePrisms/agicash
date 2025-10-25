import { agicashDbMints } from '../features/agicash-db/database.server';
import { createMerchantRemoteAccess } from '../lib/square-merchant-access.server';
import { getSquareOAuthClient } from '../lib/square-oauth.server';
import type { Route } from './+types/api.square.callback';

const clearCookies = [
  'square-state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
  'square-merchant-email=; Path=/; Max-Age=0; SameSite=Lax',
].join(', ');

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const responseType = url.searchParams.get('response_type');
  const error = url.searchParams.get('error');

  const cookieHeader = request.headers.get('Cookie');
  const cookies = Object.fromEntries(
    cookieHeader?.split('; ').map((c) => c.split('=')) || [],
  );
  const storedState = cookies['square-state'];
  const merchantEmail = cookies['square-merchant-email'];

  if (state !== storedState) {
    return new Response('CSRF verification failed', {
      status: 400,
      headers: { 'Content-Type': 'text/plain', 'Set-Cookie': clearCookies },
    });
  }

  if (!merchantEmail) {
    return new Response('Email required', {
      status: 400,
      headers: { 'Content-Type': 'text/plain', 'Set-Cookie': clearCookies },
    });
  }

  if (error) {
    return new Response(JSON.stringify({ error }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': clearCookies,
      },
    });
  }

  if (responseType === 'code' && code) {
    try {
      const oAuthApi = getSquareOAuthClient();
      const appId = import.meta.env.VITE_SQUARE_APP_ID;
      const appSecret = import.meta.env.VITE_SQUARE_APP_SECRET;

      if (!appId || !appSecret) {
        throw new Error('Square app credentials not configured');
      }

      const redirectUri = `${url.origin}/api/square/callback`;
      const result = await oAuthApi.obtainToken({
        clientId: appId,
        clientSecret: appSecret,
        code,
        grantType: 'authorization_code',
        redirectUri,
      });

      const { accessToken, refreshToken, expiresAt, merchantId } = result;

      if (!merchantId || !accessToken || !refreshToken || !expiresAt) {
        throw new Error('Missing required OAuth response fields');
      }

      const { error: dbError } = await agicashDbMints
        .from('square_merchant_credentials')
        .upsert(
          {
            merchant_id: merchantId,
            email: merchantEmail,
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: 'merchant_id',
          },
        );

      if (dbError) {
        throw new Error(`Failed to store credentials: ${dbError.message}`);
      }

      await createMerchantRemoteAccess(merchantId);

      return new Response(null, {
        status: 302,
        headers: {
          Location: '/merchant/square?success=true',
          'Set-Cookie': [
            'square-state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
            'square-merchant-email=; Path=/; Max-Age=0; SameSite=Lax',
            'square-connected=true; Path=/; Max-Age=86400; SameSite=Lax',
          ].join(', '),
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': clearCookies,
          },
        },
      );
    }
  }

  return new Response('Invalid request', {
    status: 400,
    headers: { 'Content-Type': 'text/plain', 'Set-Cookie': clearCookies },
  });
}
