import type { SupabaseClient } from '@supabase/supabase-js';
import { classify } from '../classify';
import type { Database } from '../db/database';

type Options = { abortSignal?: AbortSignal };

/** Leader election over `wallet.task_processing_locks` via the `take_lead` RPC (one lock per user; 6s server TTL). */
export class TaskProcessingLockRepository {
  constructor(private readonly db: SupabaseClient<Database>) {}

  /** Attempt to take or refresh the per-user processing lead. Returns true when this client holds it. */
  async takeLead(
    userId: string,
    clientId: string,
    options?: Options,
  ): Promise<boolean> {
    const query = this.db.rpc('take_lead', {
      p_user_id: userId,
      p_client_id: clientId,
    });
    if (options?.abortSignal) query.abortSignal(options.abortSignal);
    const { data, error } = await query;
    if (error) throw classify(error);
    return data ?? false;
  }
}
