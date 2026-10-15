import { createClient } from '@supabase/supabase-js';
import type { Logger } from '../domain/sdk';
import type { AgicashDb, Database } from './database';

type AgicashDbClientConfig = {
  url: string;
  anonKey: string;
  /** Resolves the Supabase session JWT; null selects the anon key. */
  accessToken: () => Promise<string | null>;
  /** Receives realtime transport logs at debug; frame bodies of `push`/`receive` and of a `channel` "discarded push" are dropped (they carry the access token and row payloads). */
  logger?: Logger;
};

/** Builds the SDK's own Supabase client (wallet schema). */
export function createAgicashDbClient(
  config: AgicashDbClientConfig,
): AgicashDb {
  const { logger } = config;
  return createClient<Database>(config.url, config.anonKey, {
    accessToken: config.accessToken,
    db: { schema: 'wallet' },
    ...(logger && {
      realtime: {
        logger: (kind: string, msg: string, data?: unknown) => {
          const keepData =
            kind !== 'push' &&
            kind !== 'receive' &&
            !(kind === 'channel' && msg.startsWith('discarded push'));
          logger.debug(
            `Realtime ${kind}: ${msg}`,
            keepData ? { data } : undefined,
          );
        },
        logLevel: 'info',
      },
    }),
  });
}
