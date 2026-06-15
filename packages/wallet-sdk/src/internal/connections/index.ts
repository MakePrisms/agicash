import type { SupabaseClient } from '@supabase/supabase-js';
import type { SdkConfig } from '../../config';
import type { KeyProvider } from '../crypto/keys';
import type { Database } from '../db/database';
import { SupabaseRealtimeManager } from '../realtime/supabase-realtime-manager';
import {
  configureOpenSecret,
  generateThirdPartyToken,
  isLoggedIn,
  openSecretKeyProvider,
} from './open-secret';
import { createBrowserClient } from './supabase-client';
import { SupabaseSessionTokenProvider } from './supabase-session';

/** The external clients the SDK owns, assembled once per instance. */
export type SdkConnections = {
  supabase: SupabaseClient<Database>;
  session: SupabaseSessionTokenProvider;
  realtime: SupabaseRealtimeManager;
  keys: KeyProvider;
};

/**
 * Configure OpenSecret + build the client-mode connection bundle from config.
 * Breez is NOT connected here — spark accounts connect per-account in a later
 * slice. The session provider bridges the OpenSecret JWT to Supabase's
 * `accessToken`, gated on `isLoggedIn` (read from the configured storage).
 */
export function buildConnections(config: SdkConfig): SdkConnections {
  configureOpenSecret(config);
  const session = new SupabaseSessionTokenProvider(
    async () => (await generateThirdPartyToken()).token,
    () => isLoggedIn(config.storage),
  );
  const supabase = createBrowserClient(config, session.getToken);
  const realtime = new SupabaseRealtimeManager(supabase.realtime);
  const keys = openSecretKeyProvider();
  return { supabase, session, realtime, keys };
}
