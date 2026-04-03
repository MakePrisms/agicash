import type { Cursor } from '@agicash/sdk';
import type { SdkContext } from '../sdk-context';
import type { TransactionsResult } from '../daemon/protocol';

export async function handleTransactionsCommand(
  ctx: SdkContext,
  params: { accountId?: string; limit?: number; cursor?: string },
): Promise<TransactionsResult> {
  let cursor: Cursor = null;
  if (params.cursor) {
    try {
      cursor = JSON.parse(params.cursor) as Cursor;
    } catch {
      throw new Error('Invalid cursor format');
    }
  }

  const { transactions, nextCursor } = await ctx.transactionRepo.list({
    userId: ctx.userId,
    accountId: params.accountId,
    pageSize: params.limit ?? 25,
    cursor,
  });

  const accounts = await ctx.accountRepo.getAll(ctx.userId);
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]));

  return {
    transactions: transactions.map((tx) => ({
      id: tx.id,
      direction: tx.direction,
      type: tx.type,
      state: tx.state,
      amount: tx.amount.toNumber(tx.amount.currency === 'BTC' ? 'sat' : 'cent'),
      currency: tx.amount.currency,
      accountId: tx.accountId,
      accountName: accountMap.get(tx.accountId) ?? 'Unknown',
      createdAt: tx.createdAt,
      completedAt: tx.completedAt ?? undefined,
    })),
    hasMore: nextCursor !== null,
    cursor: nextCursor ? JSON.stringify(nextCursor) : undefined,
  };
}
