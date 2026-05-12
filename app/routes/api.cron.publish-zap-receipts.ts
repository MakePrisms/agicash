/**
 * Vercel Cron endpoint. Runs every minute as fallback for the verify-endpoint
 * piggyback: if a payer never polled `/api/lnurlp/verify/...`, the zap receipt
 * still gets published here.
 *
 * Idempotent: `paid_at_unix_sec` is captured on first observation and re-used,
 * so retries produce the same event id.
 */

import { agicashDbServer } from '~/features/agicash-db/database.server';
import { LightningAddressService } from '~/features/receive/lightning-address-service';
import { getQueryClient } from '~/features/shared/query-client';
import { NostrZapRequestRepositoryServer } from '~/features/zaps/zap-request-repository.server';
import type { Route } from './+types/api.cron.publish-zap-receipts';

const BATCH_LIMIT = 50;

export async function loader({ request }: Route.LoaderArgs) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('publish-zap-receipts cron missing CRON_SECRET env var');
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const repo = new NostrZapRequestRepositoryServer(agicashDbServer);
  const rows = await repo.findUnpublishedReadyToRetry(BATCH_LIMIT);

  if (rows.length === 0) {
    return new Response(
      JSON.stringify({ scanned: 0, published: 0, errors: 0 }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  const queryClient = getQueryClient();
  const service = new LightningAddressService(
    request,
    agicashDbServer,
    queryClient,
  );

  let published = 0;
  let errors = 0;
  const settled = await Promise.allSettled(
    rows.map((row) => service.publishZapReceiptForRow(row)),
  );

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      if (result.value.status === 'published') {
        published += 1;
      } else if (result.value.status === 'failed') {
        errors += 1;
      }
    } else {
      errors += 1;
      console.error('publish-zap-receipts row failed', {
        cause: result.reason,
      });
    }
  }

  return new Response(
    JSON.stringify({ scanned: rows.length, published, errors }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}
