/**
 * Internal `wallet.transactions` repository — Slice 4 (transactions).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/transactions/transaction-repository.ts`. Master expresses this
 * over a React-hook-constructed repo wired to the module-global `agicashDbClient` +
 * `useEncryption`; here it is a plain class over the SDK-owned Supabase client + the SDK
 * {@link Encryption} (both injected). The `list_transactions` RPC + the cursor-paging +
 * the DB→domain parse (`toTransaction`) are unchanged from master.
 *
 * The DB→domain parse is the internal pipeline (decision 7-ii): decrypt the
 * `encrypted_transaction_details` jsonb, validate it with `TransactionDetailsDbDataSchema`,
 * run the 6-variant `TransactionDetailsParser` (the `z.pipe` parsers), then validate the
 * assembled row with `TransactionSchema`. Those runtime schemas are the single-source
 * re-export (`./lib-transactions`); the DB-row type is the hand-written
 * {@link AgicashDbTransaction}.
 *
 * @module
 */
import type { z } from 'zod/mini';
import type { Encryption } from './encryption';
import {
  type BaseTransactionSchema,
  TransactionDetailsDbDataSchema,
  type TransactionDetailsParserInput,
  TransactionDetailsParser,
  TransactionSchema,
} from './lib-transactions';
import type { AgicashDbTransaction } from './db-transaction';
import type { WalletSupabaseClient } from './supabase-client';
import type { Transaction, TransactionCursor } from '../types/transaction';

/** Per-call query options (an abort signal, matching master). */
type Options = { abortSignal?: AbortSignal };

/** Parameters for {@link TransactionRepository.list} (master `ListOptions`). */
type ListOptions = Options & {
  userId: string;
  cursor?: TransactionCursor | null;
  pageSize?: number;
  accountId?: string;
};

/** The default page size master uses for transaction history. */
export const DEFAULT_TRANSACTION_PAGE_SIZE = 25;

/**
 * Reads + writes for the `wallet.transactions` table, scoped (via RLS) to the signed-in user.
 * Holds the SDK-owned Supabase client + the SDK {@link Encryption}.
 */
export class TransactionRepository {
  /**
   * @param db - the SDK-owned Supabase client (schema pinned to `wallet`).
   * @param encryption - the SDK encryption (decrypts each row's `encrypted_transaction_details`).
   */
  constructor(
    private readonly db: WalletSupabaseClient,
    private readonly encryption: Encryption,
  ) {}

  /**
   * Get the transaction with the given id (or null if not found).
   *
   * Verbatim logic from master `TransactionRepository.get`.
   *
   * @param transactionId - the transaction id.
   * @param options - optional abort signal.
   * @returns the transaction, or null.
   * @throws Error if the read fails.
   */
  async get(
    transactionId: string,
    options?: Options,
  ): Promise<Transaction | null> {
    const query = this.db.from('transactions').select().eq('id', transactionId);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to get transaction', { cause: error });
    }

    return data ? this.toTransaction(data as AgicashDbTransaction) : null;
  }

  /**
   * List transactions for the user, newest-relevant first (state-sorted: PENDING first), paged
   * by an opaque cursor.
   *
   * Verbatim logic from master `TransactionRepository.list`: calls the `list_transactions` RPC
   * (the state-sort + cursor are computed DB-side), parses each row, and derives the
   * `nextCursor` from the last row (`stateSortOrder` = 2 for PENDING else 1). Note the cursor
   * always reflects the last returned row; the caller (`TransactionsDomain.list`) caps paging by
   * nulling it when the page came back short, matching master's `useTransactions`.
   *
   * @param options - `{ userId, cursor?, pageSize?, accountId?, abortSignal? }`.
   * @returns `{ transactions, nextCursor }`.
   * @throws Error if the read fails.
   */
  async list({
    userId,
    cursor = null,
    pageSize = DEFAULT_TRANSACTION_PAGE_SIZE,
    accountId,
    abortSignal,
  }: ListOptions): Promise<{
    transactions: Transaction[];
    nextCursor: TransactionCursor | null;
  }> {
    // The Supabase client is untyped until the generated Database types are lifted (a later
    // slice); the `list_transactions` RPC name/args live in the stored procedure, not the client's
    // type space — cast the call (matching the other repos) and the resulting rows.
    // biome-ignore lint/suspicious/noExplicitAny: see above.
    let query = (this.db.rpc as any)('list_transactions', {
      p_user_id: userId,
      p_cursor_state_sort_order: cursor?.stateSortOrder,
      p_cursor_created_at: cursor?.createdAt,
      p_cursor_id: cursor?.id,
      p_page_size: pageSize,
      p_account_id: accountId,
    });

    if (abortSignal) {
      query = query.abortSignal(abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to fetch transactions', { cause: error });
    }

    const rows = data as AgicashDbTransaction[];
    const transactions = await Promise.all(
      rows.map((transaction) => this.toTransaction(transaction)),
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
   * Count the user's transactions whose `acknowledgment_status` is `pending`.
   *
   * Verbatim logic from master `TransactionRepository.countTransactionsPendingAck`.
   *
   * @param params - `{ userId }`.
   * @param options - optional abort signal.
   * @returns the number of unacknowledged transactions.
   * @throws Error if the count fails.
   */
  async countTransactionsPendingAck(
    { userId }: { userId: string },
    options?: Options,
  ): Promise<number> {
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
   * Set a transaction's acknowledgment status to `acknowledged`.
   *
   * Verbatim logic from master `TransactionRepository.acknowledgeTransaction`.
   *
   * @param params - `{ userId, transactionId }`.
   * @param options - optional abort signal.
   * @throws Error if the update fails.
   */
  async acknowledgeTransaction(
    { userId, transactionId }: { userId: string; transactionId: string },
    options?: Options,
  ): Promise<void> {
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

  /**
   * Map a `wallet.transactions` DB row to the domain {@link Transaction}.
   *
   * Verbatim logic from master `TransactionRepository.toTransaction` — the internal DB→domain
   * pipeline (decision 7-ii): decrypt the `encrypted_transaction_details`, validate it as the
   * DB-data union, run the per-variant `z.pipe` parser to the domain `details`, then validate
   * the assembled row with `TransactionSchema`. Public to the SDK's own realtime forwarder
   * (Slice 5 calls this to translate a DB-change payload into a `transaction:*` event), but the
   * DB-data shape it consumes is never exposed.
   *
   * @param data - the transaction row.
   * @returns the domain transaction.
   * @throws Error if decryption or schema validation fails.
   */
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
      transactionDetails: data.transaction_details ?? undefined,
      decryptedTransactionDetails,
    } satisfies TransactionDetailsParserInput);

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
      // The single-source runtime `TransactionSchema` is authoritative; cast its parse output to
      // the hand-mirrored public `Transaction` (matching the cashu/spark repos' `toQuote` casts —
      // `z.infer` and the hand-written TS shape differ only in optional-vs-Required narrowing).
    } satisfies z.input<typeof BaseTransactionSchema>) as Transaction;
  }
}
