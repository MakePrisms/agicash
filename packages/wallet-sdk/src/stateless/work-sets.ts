import type { WalletRuntime, WorkSetSource } from '../engine';
import type { ResidentAccounts } from './resident-accounts';

/**
 * Variant A's DB-on-demand work-sets: read the protocol repo, then drop items
 * whose account is not online (tolerant — a missing account drops the item).
 * `ensureLoaded` warms the resident map before the filter, which also guarantees
 * the synchronous WalletAccess reads in `processor.reload` (which awaits this
 * read) hit a populated map.
 */
export function createWorkSets(
  runtime: WalletRuntime,
  accounts: ResidentAccounts,
): WorkSetSource {
  const onlineOnly = <T extends { accountId: string }>(items: T[]): T[] =>
    items.filter((item) => accounts.isOnline(item.accountId));

  const read = async <T extends { accountId: string }>(
    userId: string,
    fetch: (userId: string) => Promise<T[]>,
  ): Promise<T[]> => {
    await accounts.ensureLoaded(userId);
    return onlineOnly(await fetch(userId));
  };

  const p = runtime.protocols;
  return {
    getUnresolvedCashuSendQuotes: (userId) =>
      read(userId, (u) => p.cashuSendQuoteRepository.getUnresolved(u)),
    getUnresolvedCashuSendSwaps: (userId) =>
      read(userId, (u) => p.cashuSendSwapRepository.getUnresolved(u)),
    getUnresolvedSparkSendQuotes: (userId) =>
      read(userId, (u) => p.sparkSendQuoteRepository.getUnresolved(u)),
    getPendingCashuReceiveQuotes: (userId) =>
      read(userId, (u) => p.cashuReceiveQuoteRepository.getPending(u)),
    getPendingCashuReceiveSwaps: (userId) =>
      read(userId, (u) => p.cashuReceiveSwapRepository.getPending(u)),
    getPendingSparkReceiveQuotes: (userId) =>
      read(userId, (u) => p.sparkReceiveQuoteRepository.getPending(u)),
  };
}
