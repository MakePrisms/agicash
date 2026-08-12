import type { Transaction } from '../transactions/transaction';
import type { Cursor } from '../transactions/transaction-repository';

export type { Cursor };

export type TransactionsApi = {
  get(id: string): Promise<Transaction | null>;
  /**
   * Transaction history, newest first with `PENDING` transactions on top
   * (`state_sort_order desc, created_at desc, id desc`). `DRAFT` and `FAILED`
   * transactions are excluded; `get` still returns them. `nextCursor` is
   * `null` on the last page.
   */
  list(params: {
    /** Opaque pagination token from a previous page's `nextCursor`. */
    cursor?: Cursor | null;
    /** Defaults to 25. */
    pageSize?: number;
    accountId?: string;
  }): Promise<{ transactions: Transaction[]; nextCursor: Cursor | null }>;
  countPendingAck(): Promise<number>;
  acknowledge(transactionId: string): Promise<void>;
};
