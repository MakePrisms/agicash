import { getServerSdk } from '~/features/receive/server-sdk.server';
import type { Route } from './+types/[.]well-known.lnurlp.$username';

export async function loader({ request, params }: Route.LoaderArgs) {
  const sdk = await getServerSdk();
  const baseUrl = new URL(request.url).origin;
  const response = await sdk.lightningAddress.handleLud16Request({
    username: params.username,
    baseUrl,
  });
  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
