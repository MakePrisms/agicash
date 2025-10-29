import { createClient } from '@supabase/supabase-js';
import type { MintsDatabase } from '../features/agicash-db/database.server';
import { SquareMerchantRepository } from '../features/square/square-merchant-repository.server';
import { SquareTokenService } from '../features/square/square-token-service.server';
import type { Route } from './+types/api.square.refresh-tokens';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Supabase configuration missing');
}

const cronSecret = process.env.CRON_SECRET ?? '';

if (!cronSecret) {
  throw new Error('CRON_SECRET not configured');
}

/**
 * API endpoint for refreshing Square OAuth tokens.
 * Called by Vercel cron on a schedule (configured in vercel.json).
 * Requires authentication via CRON_SECRET in Authorization header.
 */
export async function loader({ request }: Route.LoaderArgs) {
  // Verify the request is authorized (from Vercel cron)
  const authHeader = request.headers.get('Authorization');
  const expectedAuth = `Bearer ${cronSecret}`;

  if (authHeader !== expectedAuth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Create Supabase client with service role key to bypass RLS
    const supabase = createClient<MintsDatabase>(
      supabaseUrl,
      supabaseServiceRoleKey,
      {
        db: { schema: 'mints' },
      },
    );

    const repository = new SquareMerchantRepository(supabase);
    const tokenService = new SquareTokenService();

    const allCredentials = await repository.getAllMerchantCredentials();

    const results = {
      total: allCredentials.length,
      refreshed: 0,
      skipped: 0,
      failed: [] as Array<{ merchantId: string; error: string }>,
    };

    // Process each merchant
    for (const credentials of allCredentials) {
      try {
        if (tokenService.shouldRefreshToken(credentials.expiresAt)) {
          const refreshResult = await tokenService.refreshToken(
            credentials.refreshToken,
          );

          await repository.upsertMerchantCredentials({
            merchantId: refreshResult.merchantId,
            email: credentials.email,
            accessToken: refreshResult.accessToken,
            refreshToken: refreshResult.refreshToken,
            expiresAt: refreshResult.expiresAt,
          });

          results.refreshed++;
          console.log(
            `Refreshed tokens for merchant: ${credentials.merchantId}`,
          );
        } else {
          results.skipped++;
          console.log(
            `Skipped refresh for merchant: ${credentials.merchantId} (token still valid)`,
          );
        }
      } catch (error) {
        results.failed.push({
          merchantId: credentials.merchantId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        console.error(
          `Failed to refresh tokens for merchant ${credentials.merchantId}:`,
          error,
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        ...results,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('Error in token refresh job:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
