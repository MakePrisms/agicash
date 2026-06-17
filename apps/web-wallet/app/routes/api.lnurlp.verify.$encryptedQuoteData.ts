import { getServerSdk } from '~/features/receive/server-sdk.server';
import type { Route } from './+types/api.lnurlp.verify.$encryptedQuoteData';

export async function loader({ params }: Route.LoaderArgs) {
  const sdk = await getServerSdk();
  const response = await sdk.lightningAddress.handleLnurlpVerify({
    encryptedQuoteData: params.encryptedQuoteData,
  });
  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
