import type { AgicashDb } from '../db/database';

type Options = {
  abortSignal?: AbortSignal;
};

/**
 * Wraps the `take_lead` RPC (a 6s lease in `wallet.task_processing_locks`): the
 * caller becomes/stays leader if no lock exists, the lock is theirs, or it expired;
 * otherwise another client holds it. Polled every 5s by the BackgroundDomain.
 */
export class TaskProcessingLockRepository {
  constructor(private readonly db: AgicashDb) {}

  /**
   * @param userId - The user to take the lead for.
   * @param clientId - The id of the client attempting to take the lead.
   * @returns True if the lead was taken/held, false otherwise.
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
      throw new Error('Take lead request failed', { cause: error });
    }

    return data;
  }
}
