import type { Transaction as DomainTransaction } from '../transactions/transaction';
import type { Cursor } from '../transactions/transaction-repository';

export type { Cursor };

export type Transaction = Omit<DomainTransaction, 'userId'>;

export type TransactionsApi = {
  get(id: string): Promise<Transaction | null>;
  list(params: {
    /** Opaque pagination token from a previous page's `nextCursor`. */
    cursor?: Cursor;
    pageSize?: number;
    accountId?: string;
  }): Promise<{ transactions: Transaction[]; nextCursor: Cursor | null }>;
  countPendingAck(): Promise<number>;
  acknowledge(transactionId: string): Promise<void>;
};
