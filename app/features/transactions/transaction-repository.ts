import type { Money } from '~/lib/money';
import { isObject } from '~/lib/utils';
import type { AgicashDb, AgicashDbTransaction } from '../agicash-db/database';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption';
import { CashuLightningReceiveDataSchema } from './cashu-lightning-receive-data';
import {
  CashuTokenReceiveTransactionDetailsSchema,
  CashuTokenSendTransactionDetailsSchema,
  CompletedCashuLightningSendTransactionDetailsSchema,
  CompletedSparkLightningSendTransactionDetailsSchema,
  IncompleteCashuLightningSendTransactionDetailsSchema,
  IncompleteSparkLightningSendTransactionDetailsSchema,
  SparkLightningReceiveTransactionDetailsSchema,
  type Transaction,
  TransactionSchema,
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
    const decryptedTransactionDetails = await this.encryption.decrypt(
      data.encrypted_transaction_details,
    );

    if (
      decryptedTransactionDetails == null ||
      !isObject(decryptedTransactionDetails)
    ) {
      throw new Error('Invalid transaction details', {
        cause: decryptedTransactionDetails,
      });
    }

    const mergedDetails = {
      ...decryptedTransactionDetails,
      ...(data.transaction_details ?? {}),
    };

    let amount: Money | undefined;
    let details: Transaction['details'] | undefined;

    const { state, direction, type } = data;

    if (type === 'CASHU_LIGHTNING' && direction === 'SEND') {
      if (state === 'COMPLETED') {
        const completedDetails =
          CompletedCashuLightningSendTransactionDetailsSchema.parse(
            mergedDetails,
          );

        amount = completedDetails.amountSpent;
        details = completedDetails;
      } else {
        const incompleteDetails =
          IncompleteCashuLightningSendTransactionDetailsSchema.parse(
            mergedDetails,
          );

        amount = incompleteDetails.amountToReceive
          .add(incompleteDetails.lightningFeeReserve)
          .add(incompleteDetails.cashuSendFee);
        details = incompleteDetails;
      }
    }

    if (type === 'CASHU_LIGHTNING' && direction === 'RECEIVE') {
      const receiveData = CashuLightningReceiveDataSchema.parse(
        decryptedTransactionDetails,
      );

      amount = receiveData.mintingFee
        ? receiveData.amountReceived.add(receiveData.mintingFee)
        : receiveData.amountReceived;
      details = {
        amountReceived: receiveData.amountReceived,
        paymentRequest: receiveData.paymentRequest,
        description: receiveData.description,
        mintingFee: receiveData.mintingFee,
      };
    }

    if (type === 'CASHU_TOKEN' && direction === 'SEND') {
      const sendDetails =
        CashuTokenSendTransactionDetailsSchema.parse(mergedDetails);
      amount = sendDetails.amountSpent;
      details = sendDetails;
    }

    if (type === 'CASHU_TOKEN' && direction === 'RECEIVE') {
      const result = CashuLightningReceiveDataSchema.safeParse(
        decryptedTransactionDetails,
      );

      if (result.success) {
        const receiveData = result.data;
        if (!receiveData.cashuTokenData) {
          throw new Error('Invalid cashu token receive data', {
            cause: receiveData,
          });
        }

        amount = receiveData.mintingFee
          ? receiveData.amountReceived.add(receiveData.mintingFee)
          : receiveData.amountReceived;
        details = {
          amountReceived: receiveData.amountReceived,
          tokenAmount: receiveData.cashuTokenData.tokenAmount,
          cashuReceiveFee: receiveData.cashuTokenData.cashuReceiveFee,
          lightningFeeReserve: receiveData.cashuTokenData.lightningFeeReserve,
          mintingFee: receiveData.mintingFee,
          totalFees: receiveData.totalFees,
        };
      } else {
        const receiveDetails =
          CashuTokenReceiveTransactionDetailsSchema.parse(mergedDetails);

        amount = receiveDetails.mintingFee
          ? receiveDetails.amountReceived.add(receiveDetails.mintingFee)
          : receiveDetails.amountReceived;
        details = receiveDetails;
      }
    }

    if (type === 'SPARK_LIGHTNING' && direction === 'RECEIVE') {
      const receiveDetails =
        SparkLightningReceiveTransactionDetailsSchema.parse(mergedDetails);

      amount = receiveDetails.amountReceived;
      details = receiveDetails;
    }

    if (type === 'SPARK_LIGHTNING' && direction === 'SEND') {
      if (state === 'COMPLETED') {
        const completedDetails =
          CompletedSparkLightningSendTransactionDetailsSchema.parse(
            mergedDetails,
          );

        amount = completedDetails.amountSpent;
        details = completedDetails;
      } else {
        const incompleteDetails =
          IncompleteSparkLightningSendTransactionDetailsSchema.parse(
            mergedDetails,
          );

        amount =
          incompleteDetails.amountSpent ??
          incompleteDetails.amountToReceive.add(incompleteDetails.estimatedFee);
        details = incompleteDetails;
      }
    }

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
      direction,
      type,
      state,
      amount,
      details,
    });
  }
}

export function useTransactionRepository() {
  const encryption = useEncryption();
  return new TransactionRepository(agicashDbClient, encryption);
}
