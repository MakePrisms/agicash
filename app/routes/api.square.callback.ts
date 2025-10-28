import {
  squareConnectedCookie,
  squareMerchantEmailCookie,
  squareStateCookie,
} from '~/features/square/square-cookies.server';
import { agicashDbMints } from '../features/agicash-db/database.server';
import { createMerchantRemoteAccess } from '../features/square/square-merchant-access.server';
import { SquareMerchantRepository } from '../features/square/square-merchant-repository.server';
import { getSquareOAuthClient } from '../features/square/square-oauth.server';
import type { Route } from './+types/api.square.callback';

const { SQUARE_APP_ID: appId = '', SQUARE_APP_SECRET: appSecret = '' } =
  process.env;
if (!appId || !appSecret) {
  throw new Error('Square app credentials not configured');
}

const clearedCookiesHeaders = async (): Promise<Headers> => {
  const headers = new Headers();
  headers.append('Content-Type', 'text/plain');
  headers.append(
    'Set-Cookie',
    await squareStateCookie.serialize('', { maxAge: 0 }),
  );
  headers.append(
    'Set-Cookie',
    await squareMerchantEmailCookie.serialize('', { maxAge: 0 }),
  );
  return headers;
};

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const responseType = url.searchParams.get('response_type');
  const error = url.searchParams.get('error');

  const cookieHeader = request.headers.get('Cookie');
  const storedState = await squareStateCookie.parse(cookieHeader);
  const merchantEmail = await squareMerchantEmailCookie.parse(cookieHeader);

  if (state !== storedState) {
    const headers = await clearedCookiesHeaders();
    headers.append('Location', '/merchant/square?error=csrf');
    return new Response(null, {
      status: 302,
      headers,
    });
  }

  if (!merchantEmail) {
    const headers = await clearedCookiesHeaders();
    headers.append('Location', '/merchant/square?error=missing_email');
    return new Response(null, {
      status: 302,
      headers,
    });
  }

  if (error) {
    const headers = await clearedCookiesHeaders();
    headers.append(
      'Location',
      `/merchant/square?error=${encodeURIComponent(error)}`,
    );
    return new Response(null, {
      status: 302,
      headers,
    });
  }

  if (responseType === 'code' && code) {
    try {
      const oAuthApi = getSquareOAuthClient();

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

      const repository = new SquareMerchantRepository(agicashDbMints);

      // Update credentials with new tokens. Old tokens remain valid until they expire, but
      // this will allow us to have a merchant refresh the tokens if they are revoked.
      await repository.upsertMerchantCredentials({
        merchantId,
        email: merchantEmail,
        accessToken,
        refreshToken,
        expiresAt,
      });

      await createMerchantRemoteAccess(merchantId);

      const headers = await clearedCookiesHeaders();
      headers.append('Location', '/merchant/square?success=true');
      headers.append(
        'Set-Cookie',
        await squareConnectedCookie.serialize('true'),
      );

      return new Response(null, {
        status: 302,
        headers,
      });
    } catch (error) {
      console.error('Error in square callback', error);
      const headers = await clearedCookiesHeaders();
      headers.append(
        'Location',
        '/merchant/square?error=internal_server_error',
      );
      return new Response(null, {
        status: 302,
        headers,
      });
    }
  }

  const headers = await clearedCookiesHeaders();
  headers.append('Location', '/merchant/square?error=invalid_request');
  return new Response(null, {
    status: 302,
    headers,
  });
}
