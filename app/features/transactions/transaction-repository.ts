import type { z } from 'zod';
import type { AgicashDb, AgicashDbTransaction } from '../agicash-db/database';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption';
import {
  type BaseTransactionSchema,
  type Transaction,
  TransactionSchema,
} from './transaction';
import { TransactionDetailsParser } from './transaction-details/transaction-details-parser';
import {
  TransactionDetailsDbDataSchema,
  type TransactionDetailsParserInput,
} from './transaction-details/transaction-details-types';

type Encryption = {
  encrypt: <T = unknown>(data: T) => Promise<string>;
  decrypt: <T = unknown>(data: string) => Promise<T>;
};

type Options = {
  abortSignal?: AbortSignal;
};

export type Cursor = {
  stateSortOrder: number;
  createdAt: string;
  id: string;
} | null;

type ListOptions = Options & {
  userId: string;
  cursor?: Cursor;
  pageSize?: number;
};

export class TransactionRepository {
  constructor(
    private db: AgicashDb,
    private encryption: Encryption,
  ) {}

  async get(transactionId: string, options?: Options) {
    const query = this.db.from('transactions').select().eq('id', transactionId);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.single();

    if (error) {
      throw new Error('Failed to get transaction', { cause: error });
    }

    return this.toTransaction(data);
  }

  async list({
    userId,
    cursor = null,
    pageSize = 25,
    abortSignal,
  }: ListOptions) {
    const query = this.db.rpc('list_transactions', {
      p_user_id: userId,
      p_cursor_state_sort_order: cursor?.stateSortOrder,
      p_cursor_created_at: cursor?.createdAt,
      p_cursor_id: cursor?.id,
      p_page_size: pageSize,
    });

    if (abortSignal) {
      query.abortSignal(abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to fetch transactions', { cause: error });
    }

    const transactions = await Promise.all(
      data.map((transaction) => this.toTransaction(transaction)),
    );
    const lastTransaction = transactions[transactions.length - 1];

    return {
      transactions,
      nextCursor: lastTransaction
        ? {
            stateSortOrder: lastTransaction.state === 'PENDING' ? 2 : 1,
            createdAt: lastTransaction.createdAt,
            id: lastTransaction.id,
          }
        : null,
    };
  }

  /**
   * Counts the number of transactions where the acknowledgment status is pending.
   *
   * @returns The number of unacknowledged transactions.
   */
  async countTransactionsPendingAck(
    {
      userId,
    }: {
      userId: string;
    },
    options?: Options,
  ) {
    const query = this.db
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('acknowledgment_status', 'pending');

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { count, error } = await query;

    if (error || count === null) {
      throw new Error('Failed to count transactions pending acknowledgment', {
        cause: error,
      });
    }

    return count;
  }

  /**
   * Sets a transaction's acknowledgment status to acknowledged.
   * @throws {Error} If the transaction is not found or the acknowledgment status cannot be set.
   */
  async acknowledgeTransaction(
    {
      userId,
      transactionId,
    }: {
      userId: string;
      transactionId: string;
    },
    options?: Options,
  ) {
    const query = this.db
      .from('transactions')
      .update({ acknowledgment_status: 'acknowledged' })
      .eq('id', transactionId)
      .eq('user_id', userId);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { error } = await query;

    if (error) {
      throw new Error('Failed to mark transaction as seen', { cause: error });
    }
  }

  async toTransaction(data: AgicashDbTransaction): Promise<Transaction> {
    const decryptedData = await this.encryption.decrypt(
      data.encrypted_transaction_details,
    );
    const decryptedTransactionDetails =
      TransactionDetailsDbDataSchema.parse(decryptedData);

    const details = TransactionDetailsParser.parse({
      type: data.type,
      direction: data.direction,
      state: data.state,
      transactionDetails: data.transaction_details,
      decryptedTransactionDetails,
    } satisfies TransactionDetailsParserInput);

    return TransactionSchema.parse({
      id: data.id,
      userId: data.user_id,
      accountId: data.account_id,
      createdAt: data.created_at,
      pendingAt: data.pending_at,
      completedAt: data.completed_at,
      failedAt: data.failed_at,
      reversedTransactionId: data.reversed_transaction_id,
      reversedAt: data.reversed_at,
      acknowledgmentStatus: data.acknowledgment_status,
      direction: data.direction,
      type: data.type,
      state: data.state,
      amount: details.amount,
      details,
    } satisfies z.input<typeof BaseTransactionSchema>);
  }
}

export function useTransactionRepository() {
  const encryption = useEncryption();
  return new TransactionRepository(agicashDbClient, encryption);
}
