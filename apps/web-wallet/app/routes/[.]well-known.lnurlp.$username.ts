/**
 * This route implements the `/.well-known/lnurlp/$username` endpoint
 * defined by LUD 16: https://github.com/lnurl/luds/blob/luds/16.md
 */

import { getServerSdk } from '~/features/shared/sdk.server';
import { getCanonicalOrigin } from '~/lib/canonical-origin.server';
import type { LNURLError, LNURLPayParams } from '~/lib/lnurl/types';
import type { Route } from './+types/[.]well-known.lnurlp.$username';

export async function loader({ request, params }: Route.LoaderArgs) {
  const origin = getCanonicalOrigin(new URL(request.url).origin);
  const domain = new URL(origin).host;

  let body: LNURLPayParams | LNURLError;
  try {
    const info = await getServerSdk(domain).resolveLightningAddress(
      params.username,
    );
    body = info
      ? {
          callback: `${origin}/api/lnurlp/callback/${info.userId}`,
          maxSendable: info.maxSendable.toNumber('msat'),
          minSendable: info.minSendable.toNumber('msat'),
          metadata: info.metadata,
          tag: 'payRequest',
        }
      : { status: 'ERROR', reason: 'not found' };
  } catch (error) {
    console.error('Error processing LNURL-pay request', { cause: error });
    body = { status: 'ERROR', reason: 'Internal server error' };
  }

  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
