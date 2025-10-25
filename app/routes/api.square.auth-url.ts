import {
  buildSquareAuthUrl,
  generateSquareAuthParams,
} from '../lib/square-oauth.server';
import type { Route } from './+types/api.square.auth-url';

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const { state, appId, baseUrl } = generateSquareAuthParams();

    if (!appId || !baseUrl) {
      throw new Error('Square credentials not configured');
    }

    const url = new URL(request.url);
    const redirectUri = `${url.origin}/api/square/callback`;
    const scopes = ['PAYMENTS_READ', 'MERCHANT_PROFILE_READ'];

    const authUrl = buildSquareAuthUrl({
      appId,
      baseUrl,
      state,
      redirectUri,
      scopes,
    });

    return new Response(JSON.stringify({ authUrl, state }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
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
