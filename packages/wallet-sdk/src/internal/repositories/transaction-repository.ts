import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod/mini';
import type { EncryptionService } from '../crypto/encryption';
import { classify } from '../classify';
import type { Database } from '../db/database';
import {
  type BaseTransactionSchema,
  TransactionSchema,
} from '../db/transaction';
import { TransactionDetailsParser } from '../db/transaction-details/transaction-details-parser';
import {
  TransactionDetailsDbDataSchema,
  type TransactionDetailsParserInput,
} from '../db/transaction-details/transaction-details-types';
import type { Transaction, TransactionCursor } from '../../types/transaction';

type TransactionRow =
  Database['wallet']['Functions']['list_transactions']['Returns'][number];

export type ListTransactionsParams = {
  userId: string;
  cursor?: TransactionCursor | null;
  pageSize?: number;
  accountId?: string;
};

/** Read-mostly access to `wallet.transactions` (rows are written server-side by quote RPCs). */
export class TransactionRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly encryption: EncryptionService,
  ) {}

  async get(transactionId: string): Promise<Transaction | null> {
    const { data, error } = await this.db
      .from('transactions')
      .select()
      .eq('id', transactionId)
      .maybeSingle();
    if (error) throw classify(error);
    return data ? this.toTransaction(data as TransactionRow) : null;
  }

  async list({
    userId,
    cursor = null,
    pageSize = 25,
    accountId,
  }: ListTransactionsParams): Promise<{
    transactions: Transaction[];
    nextCursor: TransactionCursor | null;
  }> {
    const { data, error } = await this.db.rpc('list_transactions', {
      p_user_id: userId,
      p_cursor_state_sort_order: cursor?.stateSortOrder,
      p_cursor_created_at: cursor?.createdAt,
      p_cursor_id: cursor?.id,
      p_page_size: pageSize,
      p_account_id: accountId,
    });
    if (error) throw classify(error);

    const transactions = await Promise.all(
      (data ?? []).map((tx) => this.toTransaction(tx)),
    );
    const last = transactions[transactions.length - 1];
    // Only advance the cursor on a full page (a short page is the last page);
    // otherwise a short final page would re-fetch forever.
    const nextCursor =
      last && transactions.length >= pageSize
        ? {
            stateSortOrder: last.state === 'PENDING' ? 2 : 1,
            createdAt: last.createdAt,
            id: last.id,
          }
        : null;

    return { transactions, nextCursor };
  }

  async countPendingAck(userId: string): Promise<number> {
    const { count, error } = await this.db
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('acknowledgment_status', 'pending');
    if (error || count === null)
      throw classify(error ?? new Error('null count'));
    return count;
  }

  /** Flip `acknowledgment_status` to `acknowledged`; returns the re-read (version-incremented) row. */
  async acknowledge({
    userId,
    transactionId,
  }: {
    userId: string;
    transactionId: string;
  }): Promise<Transaction> {
    const { data, error } = await this.db
      .from('transactions')
      .update({ acknowledgment_status: 'acknowledged' })
      .eq('id', transactionId)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw classify(error);
    return this.toTransaction(data as TransactionRow);
  }

  async toTransaction(data: TransactionRow): Promise<Transaction> {
    const enc = await this.encryption.get();
    const decrypted = await enc.decrypt(data.encrypted_transaction_details);
    const decryptedTransactionDetails =
      TransactionDetailsDbDataSchema.parse(decrypted);

    const details = TransactionDetailsParser.parse({
      type: data.type,
      direction: data.direction,
      state: data.state,
      transactionDetails: data.transaction_details,
      decryptedTransactionDetails,
    } satisfies TransactionDetailsParserInput);

    // runtime-validated by TransactionSchema.parse; cast bridges the structurally-equal internal z.infer to the public Transaction (TS can't prove the union×intersection assignability).
    return TransactionSchema.parse({
      id: data.id,
      userId: data.user_id,
      accountId: data.account_id,
      accountName: data.account_name,
      accountType: data.account_type,
      accountPurpose: data.account_purpose,
      createdAt: data.created_at,
      pendingAt: data.pending_at,
      completedAt: data.completed_at,
      failedAt: data.failed_at,
      reversedTransactionId: data.reversed_transaction_id,
      purpose: data.purpose,
      reversedAt: data.reversed_at,
      acknowledgmentStatus: data.acknowledgment_status,
      version: data.version,
      direction: data.direction,
      type: data.type,
      state: data.state,
      amount: details.amount,
      details,
    } satisfies z.input<typeof BaseTransactionSchema>) as Transaction;
  }
}
