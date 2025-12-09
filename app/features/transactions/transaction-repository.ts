import type { Money } from '~/lib/money';
import { isObject } from '~/lib/utils';
import {
  type AgicashDb,
  type AgicashDbTransaction,
  agicashDb,
} from '../agicash-db/database';
import { useEncryption } from '../shared/encryption';
import type {
  CashuLightningReceiveTransactionDetails,
  CashuTokenReceiveTransactionDetails,
  CashuTokenSendTransactionDetails,
  CompletedCashuLightningSendTransactionDetails,
  IncompleteCashuLightningSendTransactionDetails,
  SparkLightningReceiveTransactionDetails,
  SparkLightningSendTransactionDetails,
  Transaction,
} from './transaction';

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

type UnifiedTransactionDetails =
  | CashuTokenReceiveTransactionDetails
  | CashuTokenSendTransactionDetails
  | CashuLightningReceiveTransactionDetails
  | IncompleteCashuLightningSendTransactionDetails
  | CompletedCashuLightningSendTransactionDetails
  | SparkLightningReceiveTransactionDetails
  | SparkLightningSendTransactionDetails;

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
    const decryptedDetails =
      await this.encryption.decrypt<UnifiedTransactionDetails>(
        data.encrypted_transaction_details,
      );

    if (
      data.transaction_details !== null &&
      !isObject(data.transaction_details)
    ) {
      throw new Error(
        `Invalid transaction details. Expected object or null, got ${typeof data.transaction_details}`,
      );
    }

    const details = {
      ...decryptedDetails,
      ...(data.transaction_details ?? {}),
    };

    const baseTx = {
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
    };

    const { state, direction, type } = data;

    const createTransaction = <T extends Transaction>(
      amount: Money,
      transactionDetails: T['details'],
    ): T =>
      ({
        ...baseTx,
        direction,
        type,
        state,
        amount,
        details: transactionDetails,
      }) as T;

    // Lightning send transactions have different amounts based on completion state
    if (type === 'CASHU_LIGHTNING' && direction === 'SEND') {
      if (state === 'COMPLETED') {
        const completedDetails =
          details as CompletedCashuLightningSendTransactionDetails;
        return createTransaction(
          completedDetails.amountSpent,
          completedDetails,
        );
      }
      const incompleteDetails =
        details as IncompleteCashuLightningSendTransactionDetails;
      return createTransaction(
        incompleteDetails.amountToReceive
          .add(incompleteDetails.lightningFeeReserve)
          .add(incompleteDetails.cashuSendFee),
        incompleteDetails,
      );
    }

    if (type === 'CASHU_LIGHTNING' && direction === 'RECEIVE') {
      const receiveDetails = details as CashuLightningReceiveTransactionDetails;
      return createTransaction(receiveDetails.amountReceived, receiveDetails);
    }

    if (type === 'CASHU_TOKEN' && direction === 'SEND') {
      const sendDetails = details as CashuTokenSendTransactionDetails;
      return createTransaction(sendDetails.amountSpent, sendDetails);
    }

    if (type === 'CASHU_TOKEN' && direction === 'RECEIVE') {
      const receiveDetails = details as CashuTokenReceiveTransactionDetails;
      return createTransaction(receiveDetails.amountReceived, receiveDetails);
    }

    if (type === 'SPARK_LIGHTNING' && direction === 'RECEIVE') {
      const receiveDetails = details as SparkLightningReceiveTransactionDetails;
      return createTransaction(receiveDetails.amountReceived, receiveDetails);
    }

    if (type === 'SPARK_LIGHTNING' && direction === 'SEND') {
      const sendDetails = details as SparkLightningSendTransactionDetails;
      return createTransaction(sendDetails.amountSpent, sendDetails);
    }

    throw new Error('Invalid transaction data', { cause: data });
  }
}

export function useTransactionRepository() {
  const encryption = useEncryption();
  return new TransactionRepository(agicashDb, encryption);
}
