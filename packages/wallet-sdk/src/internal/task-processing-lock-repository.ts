/**
 * Task-processing leader-election lock — Slice 5 / PR7 (background).
 *
 * LIFTED VERBATIM (re-housed framework-free) from
 * `apps/web-wallet/app/features/wallet/task-processing-lock-repository.ts`. Master's class was
 * ALREADY framework-free (it takes an `AgicashDb`, no React) — the only re-housing is the
 * constructor parameter type ({@link WalletSupabaseClient}, the SDK-owned Supabase client) in
 * place of master's `AgicashDb`. The body — the `take_lead` RPC + abort-signal threading + error
 * wrapping — is master verbatim.
 *
 * `take_lead` is a Postgres function that atomically grants OR renews the processing lead for a
 * `(user_id)` to the calling `client_id` (and lets the holder keep it while its heartbeat is
 * fresh), returning `true` when this client now holds the lead and `false` when another client
 * does. Polling it on an interval (the {@link LeaderElection} timer loop) is how the SDK ensures
 * exactly one instance runs the background processor across tabs / devices / processes.
 *
 * @module
 */
import type { WalletSupabaseClient } from './supabase-client';

/** Optional per-call controls (master verbatim). */
type Options = {
  /** Abort the in-flight `take_lead` request (e.g. on stop / destroy). */
  abortSignal?: AbortSignal;
};

/**
 * Reads/writes the `wallet.task_processing_locks` table via the `take_lead` RPC. Holds the
 * SDK-owned Supabase client; one instance per SDK, driven by {@link LeaderElection}.
 */
export class TaskProcessingLockRepository {
  /**
   * @param db - the SDK-owned Supabase client (schema pinned to `wallet`).
   */
  constructor(private readonly db: WalletSupabaseClient) {}

  /**
   * Attempts to take the lead on processing tasks for the given user.
   *
   * @param userId - The id of the user to take the lead for.
   * @param clientId - The id of the client that is attempting to take the lead.
   * @param options - optional abort signal.
   * @returns True if the lead was taken, false otherwise.
   * @throws Error if the RPC fails.
   */
  async takeLead(
    userId: string,
    clientId: string,
    options?: Options,
  ): Promise<boolean> {
    const query = this.db.rpc('take_lead', {
      p_user_id: userId,
      p_client_id: clientId,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Take lead request failed', {
        cause: error,
      });
    }

    return data as boolean;
  }
}
