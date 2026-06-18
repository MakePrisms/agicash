import type { TransactionsDomain } from '../../domains';
import { SdkError } from '../../errors';
import { getCurrentUserId } from '../../internal/connections/open-secret';
import type { TransactionRepository } from '../../internal/repositories/transaction-repository';
import type { DomainContext } from '../context';

/** Build the transactions domain over the shared context (read-mostly + acknowledge). */
export function createTransactionsDomain(
  ctx: DomainContext,
  repo: TransactionRepository,
): TransactionsDomain {
  const requireUserId = async (): Promise<string> => {
    const id = await getCurrentUserId(ctx.config.storage);
    if (!id) throw new SdkError('No active session', 'NOT_AUTHENTICATED');
    return id;
  };

  return {
    async list(params) {
      const userId = await requireUserId();
      return repo.list({ userId, ...params });
    },

    get(id) {
      return repo.get(id);
    },

    async countPendingAck() {
      return repo.countPendingAck(await requireUserId());
    },

    async acknowledge(transaction) {
      // Only a real pending → acknowledged transition is a write + an event.
      if (transaction.acknowledgmentStatus !== 'pending') return;
      const userId = await requireUserId();
      const updated = await repo.acknowledge({
        userId,
        transactionId: transaction.id,
      });
      ctx.emitter.emit('transaction:updated', { transaction: updated });
    },
  };
}
