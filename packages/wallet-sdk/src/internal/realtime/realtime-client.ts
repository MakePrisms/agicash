import type { AgicashDb } from '../db/database';
import { SupabaseRealtimeManager } from './supabase-realtime-manager';

/**
 * Builds the SDK's realtime manager over the owned Supabase client's RealtimeClient.
 * The change-feed (Task 6) owns the returned manager. Host-callable online/active
 * control is finalised in Plan 4c when the Sdk surface is wired; for now callers
 * reach `setOnlineStatus` / `setActiveStatus` directly on the returned manager.
 * Headless hosts default to online=true / active=true (the manager's initial state).
 */
export function createRealtimeManager(db: AgicashDb): SupabaseRealtimeManager {
  return new SupabaseRealtimeManager(db.realtime);
}
