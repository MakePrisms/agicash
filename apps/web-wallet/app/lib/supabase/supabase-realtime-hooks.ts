/**
 * Error thrown when a Supabase Realtime channel fails to connect.
 *
 * The Variant-A SDK delivers realtime updates via `sdk.on(...)` instead of a
 * Supabase broadcast channel, so the channel hooks are gone. This class is kept
 * because `root.tsx`'s error boundary still branches on it; that branch is
 * removed in a later task.
 */
export class SupabaseRealtimeError extends Error {
  constructor(
    message: string,
    public readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'SupabaseRealtimeError';
  }
}
