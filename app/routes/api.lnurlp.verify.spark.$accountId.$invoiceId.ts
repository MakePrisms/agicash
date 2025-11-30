/**
 * This route implements the LNURL-pay verify endpoint for Spark invoices
 * defined by LUD21:  https://github.com/lnurl/luds/blob/luds/21.md
 */

import { agicashDbServiceRole } from '~/features/agicash-db/database.server';
import { LightningAddressService } from '~/features/receive/lightning-address-service';
import { getServerQueryClient } from '~/query-client';
import type { Route } from './+types/api.lnurlp.verify.spark.$accountId.$invoiceId';

export async function loader({ request, params }: Route.LoaderArgs) {
  const { accountId, invoiceId } = params;

  const queryClient = getServerQueryClient();
  const lightningAddressService = new LightningAddressService(
    request,
    agicashDbServiceRole,
    { queryClient },
  );

  const response = await lightningAddressService.handleSparkLnurlpVerify(
    accountId,
    invoiceId,
  );

  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
