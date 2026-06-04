/**
 * `TransactionsDomain` implementation — §7 of the contract, Slice 4.
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/transactions/transaction-hooks.ts` (`useTransactions` /
 * `useTransaction` / `useHasTransactionsPendingAck` / `useAcknowledgeTransaction`) +
 * `transaction-repository.ts`. Master expresses these as React hooks over a TanStack
 * `TransactionsCache` + an infinite query; the SDK exposes them as plain async methods over the
 * SDK-owned repository (no cache — events drive the consumer's read-model).
 *
 * Two-mode API rule (Josip 6/01): `list`/`get`/`countPendingAck` are FETCHES; `acknowledge`
 * takes the FULL transaction object (user-invoked). Background-processor DB reads are Slice 5.
 *
 * @module
 */
import type { SessionResolver } from '../internal/session';
import {
  DEFAULT_TRANSACTION_PAGE_SIZE,
  type TransactionRepository,
} from '../internal/transaction-repository';
import type { TransactionsDomain } from '../domains';
import type { Transaction, TransactionCursor } from '../types/transaction';

/**
 * The transactions domain. Construct with the transaction repository (DB read/write) and the
 * session resolver (current user id, for the RLS-scoped user-id filter the RPCs/counts take).
 */
export class TransactionsDomainImpl implements TransactionsDomain {
  /**
   * @param transactions - the `wallet.transactions` repository.
   * @param session - resolves the current user (id).
   */
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly session: SessionResolver,
  ) {}

  /**
   * List transactions, state-sorted (PENDING first), cursor-paginated (fetch). Re-houses master
   * `useTransactions`: calls the repository `list` (the `list_transactions` RPC) for the user,
   * then CAPS paging exactly as master does — `nextCursor` is non-null only when the page came
   * back full (a short page means there is no next page). `pageSize` defaults to master's 25.
   *
   * @param params - optional `{ accountId, cursor, pageSize }`.
   * @returns `{ transactions, nextCursor }` (nextCursor null when exhausted).
   */
  async list(params?: {
    accountId?: string;
    cursor?: TransactionCursor;
    pageSize?: number;
  }): Promise<{
    transactions: Transaction[];
    nextCursor: TransactionCursor | null;
  }> {
    const user = await this.session.requireCurrentUser();
    const pageSize = params?.pageSize ?? DEFAULT_TRANSACTION_PAGE_SIZE;

    const result = await this.transactions.list({
      userId: user.id,
      cursor: params?.cursor ?? null,
      pageSize,
      accountId: params?.accountId,
    });

    return {
      transactions: result.transactions,
      // Master caps paging: only advance the cursor when the page was full.
      nextCursor:
        result.transactions.length === pageSize ? result.nextCursor : null,
    };
  }

  /**
   * Fetch a single transaction by id, or null (fetch). Re-houses master `useTransaction`'s read
   * (without the React `NotFoundError`-on-missing throw — the contract returns null).
   *
   * @param id - the transaction id.
   * @returns the transaction, or null.
   */
  async get(id: string): Promise<Transaction | null> {
    return this.transactions.get(id);
  }

  /**
   * Count the user's transactions whose `acknowledgmentStatus` is `pending` (fetch). Re-houses
   * master `useHasTransactionsPendingAck`'s `countTransactionsPendingAck` (returning the count,
   * not the `> 0` boolean the hook derives).
   *
   * @returns the number of unacknowledged transactions.
   */
  async countPendingAck(): Promise<number> {
    const user = await this.session.requireCurrentUser();
    return this.transactions.countTransactionsPendingAck({ userId: user.id });
  }

  /**
   * Mark `transaction` as acknowledged (FULL object). Re-houses master
   * `useAcknowledgeTransaction`'s mutation (sans the cache writes — the consumer updates its own
   * read-model from the resulting `transaction:updated` event).
   *
   * @param transaction - the transaction to acknowledge.
   */
  async acknowledge(transaction: Transaction): Promise<void> {
    const user = await this.session.requireCurrentUser();
    await this.transactions.acknowledgeTransaction({
      userId: user.id,
      transactionId: transaction.id,
    });
  }
}
