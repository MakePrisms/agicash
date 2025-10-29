import {
  squareMerchantEmailCookie,
  squareStateCookie,
} from '~/features/square/square-cookies.server';
import {
  buildSquareAuthUrl,
  generateSquareAuthParams,
} from '~/features/square/square-oauth.server';
import type { Route } from './+types/api.square.auth-url';

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const url = new URL(request.url);
    const email = url.searchParams.get('email');

    if (!email) {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { state, appId, baseUrl } = generateSquareAuthParams();

    if (!appId || !baseUrl) {
      throw new Error('Square credentials not configured');
    }

    const redirectUri = `${url.origin}/api/square/callback`;
    const scopes = ['PAYMENTS_READ', 'MERCHANT_PROFILE_READ'];

    const authUrl = buildSquareAuthUrl({
      appId,
      baseUrl,
      state,
      redirectUri,
      scopes,
    });

    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.append('Set-Cookie', await squareStateCookie.serialize(state));
    headers.append(
      'Set-Cookie',
      await squareMerchantEmailCookie.serialize(email),
    );

    return new Response(JSON.stringify({ authUrl }), {
      status: 200,
      headers,
    });
  } catch {
    return new Response(
      JSON.stringify({ error: 'Failed to generate auth URL' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
