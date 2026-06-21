/**
 * This route implements the LNURL-pay verify endpoint
 * defined by LUD21: https://github.com/lnurl/luds/blob/luds/21.md
 */

import { NotFoundError } from '@agicash/wallet-sdk';
import { getLnurlVerifyTokenCodec } from '~/features/receive/lnurl-verify-token.server';
import { getServerSdk } from '~/features/shared/sdk.server';
import { getCanonicalOrigin } from '~/lib/canonical-origin.server';
import type { LNURLError, LNURLVerifyResult } from '~/lib/lnurl/types';
import type { Route } from './+types/api.lnurlp.verify.$encryptedQuoteData';

export async function loader({ request, params }: Route.LoaderArgs) {
  const domain = new URL(getCanonicalOrigin(new URL(request.url).origin)).host;

  let body: LNURLVerifyResult | LNURLError;
  try {
    const ref = getLnurlVerifyTokenCodec().decode(params.encryptedQuoteData);
    const status = await getServerSdk(domain).getLightningReceiveStatus(ref);
    body = {
      status: 'OK',
      settled: status.settled,
      preimage: status.preimage,
      pr: status.paymentRequest,
    };
  } catch (error) {
    console.error('Error processing LNURL-pay verify', { cause: error });
    body = {
      status: 'ERROR',
      reason:
        error instanceof NotFoundError ? 'Not found' : 'Internal server error',
    };
  }

  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
