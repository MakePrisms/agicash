/**
 * This route implements the LNURL-pay verify endpoint
 * defined by LUD21: https://github.com/lnurl/luds/blob/luds/21.md
 */

import { serverSdk } from '~/features/shared/sdk.server';
import type { Route } from './+types/api.lnurlp.verify.$encryptedQuoteData';

export async function loader({ params }: Route.LoaderArgs) {
  const { encryptedQuoteData } = params;

  const response = await serverSdk.lightningAddress.handleLnurlpVerify({
    encryptedQuoteData,
  });

  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
