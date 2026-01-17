import type z from 'zod';
import type { Money } from '~/lib/money';
import type { AgicashDb, AgicashDbTransaction } from '../agicash-db/database';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption';
import { CashuLightningReceiveDataSchema } from './cashu-lightning-receive-data';
import { CashuLightningSendDataSchema } from './cashu-lightning-send-data';
import { CashuSwapReceiveDataSchema } from './cashu-swap-receive-data';
import { CashuSwapSendDataSchema } from './cashu-swap-send-data';
import {
  SparkLightningReceiveDataSchema,
  SparkLightningReceiveNonSensitiveDataSchema,
} from './spark-lightning-receive-data';
import {
  SparkLightningSendDataSchema,
  SparkLightningSendNonSensitiveDataSchema,
} from './spark-lightning-send-data';
import {
  type CashuLightningReceiveTransactionDetails,
  type CashuTokenReceiveTransactionDetails,
  type CashuTokenSendTransactionDetails,
  CompletedCashuLightningSendTransactionDetailsSchema,
  CompletedSparkLightningReceiveTransactionDetailsSchema,
  CompletedSparkLightningSendTransactionDetailsSchema,
  type IncompleteCashuLightningSendTransactionDetails,
  type IncompleteSparkLightningSendTransactionDetails,
  type SparkLightningReceiveTransactionDetails,
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

    const { state, direction, type } = data;

    const baseTransaction = {
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
    };

    if (type === 'CASHU_LIGHTNING' && direction === 'SEND') {
      const sendData = CashuLightningSendDataSchema.parse(
        decryptedTransactionDetails,
      );

      if (state === 'COMPLETED') {
        const details =
          CompletedCashuLightningSendTransactionDetailsSchema.parse({
            amountReserved: sendData.amountReserved,
            amountToReceive: sendData.amountToReceive,
            lightningFeeReserve: sendData.lightningFeeReserve,
            cashuSendFee: sendData.cashuSendFee,
            paymentRequest: sendData.paymentRequest,
            destinationDetails: sendData.destinationDetails,
            // zod parse will do a runtime check that will make sure that amountSpent, paymentPreimage, lightningFee and totalFees are defined
            amountSpent: sendData.amountSpent as Money,
            preimage: sendData.paymentPreimage as string,
            lightningFee: sendData.lightningFee as Money,
            totalFees: sendData.totalFees as Money,
          } satisfies z.input<
            typeof CompletedCashuLightningSendTransactionDetailsSchema
          >);

        return TransactionSchema.parse({
          ...baseTransaction,
          amount: details.amountSpent,
          details,
        });
      }

      const details: IncompleteCashuLightningSendTransactionDetails = {
        amountReserved: sendData.amountReserved,
        amountToReceive: sendData.amountToReceive,
        lightningFeeReserve: sendData.lightningFeeReserve,
        cashuSendFee: sendData.cashuSendFee,
        paymentRequest: sendData.paymentRequest,
        destinationDetails: sendData.destinationDetails,
      };

      return TransactionSchema.parse({
        ...baseTransaction,
        amount: details.amountToReceive
          .add(details.lightningFeeReserve)
          .add(details.cashuSendFee),
        details,
      });
    }

    if (type === 'CASHU_LIGHTNING' && direction === 'RECEIVE') {
      const receiveData = CashuLightningReceiveDataSchema.parse(
        decryptedTransactionDetails,
      );
      const details: CashuLightningReceiveTransactionDetails = {
        amountReceived: receiveData.amountReceived,
        paymentRequest: receiveData.paymentRequest,
        description: receiveData.description,
        mintingFee: receiveData.mintingFee,
      };

      return TransactionSchema.parse({
        ...baseTransaction,
        amount: details.mintingFee
          ? details.amountReceived.add(details.mintingFee)
          : details.amountReceived,
        details,
      });
    }

    if (type === 'CASHU_TOKEN' && direction === 'SEND') {
      const sendData = CashuSwapSendDataSchema.parse(
        decryptedTransactionDetails,
      );
      const details: CashuTokenSendTransactionDetails = {
        amountSpent: sendData.amountSpent,
        amountToReceive: sendData.amountToReceive,
        cashuSendFee: sendData.cashuSendFee,
        cashuReceiveFee: sendData.cashuReceiveFee,
        totalFees: sendData.totalFees,
      };

      return TransactionSchema.parse({
        ...baseTransaction,
        amount: details.amountSpent,
        details,
      });
    }

    if (type === 'CASHU_TOKEN' && direction === 'RECEIVE') {
      // For CASHU_TOKEN receives, the transaction encrypted data might be a CashuLightningReceiveData (if cashu token was received to different mint than the one that issued the token, lightning receive was done and token melted to pay it)
      // or a CashuSwapReceiveData. We need to parse the data and determine which type it is.

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
        const details: CashuTokenReceiveTransactionDetails = {
          amountReceived: receiveData.amountReceived,
          tokenAmount: receiveData.cashuTokenData.tokenAmount,
          cashuReceiveFee: receiveData.cashuTokenData.cashuReceiveFee,
          lightningFeeReserve: receiveData.cashuTokenData.lightningFeeReserve,
          mintingFee: receiveData.mintingFee,
          totalFees: receiveData.totalFees,
        };

        return TransactionSchema.parse({
          ...baseTransaction,
          amount: details.mintingFee
            ? details.amountReceived.add(details.mintingFee)
            : details.amountReceived,
          details,
        });
      }

      const receiveData = CashuSwapReceiveDataSchema.parse(
        decryptedTransactionDetails,
      );
      const details: CashuTokenReceiveTransactionDetails = {
        amountReceived: receiveData.amountReceived,
        tokenAmount: receiveData.tokenAmount,
        cashuReceiveFee: receiveData.cashuReceiveFee,
        totalFees: receiveData.totalFees,
      };

      return TransactionSchema.parse({
        ...baseTransaction,
        amount: details.amountReceived,
        details,
      });
    }

    if (type === 'SPARK_LIGHTNING' && direction === 'RECEIVE') {
      const receiveData = SparkLightningReceiveDataSchema.parse(
        decryptedTransactionDetails,
      );
      const nonSensitiveReceiveData =
        SparkLightningReceiveNonSensitiveDataSchema.parse(
          data.transaction_details,
        );

      if (state === 'COMPLETED') {
        const details =
          CompletedSparkLightningReceiveTransactionDetailsSchema.parse({
            amountReceived: receiveData.amountReceived,
            paymentRequest: receiveData.paymentRequest,
            description: receiveData.description,
            // zod parse will do a runtime check that will make sure that paymentPreimage and sparkTransferId are not null
            paymentPreimage: receiveData.paymentPreimage as string,
            sparkTransferId: nonSensitiveReceiveData.sparkTransferId as string,
          } satisfies z.input<
            typeof CompletedSparkLightningReceiveTransactionDetailsSchema
          >);

        return TransactionSchema.parse({
          ...baseTransaction,
          amount: details.amountReceived,
          details,
        });
      }

      const details: SparkLightningReceiveTransactionDetails = {
        amountReceived: receiveData.amountReceived,
        paymentRequest: receiveData.paymentRequest,
        description: receiveData.description,
      };

      return TransactionSchema.parse({
        ...baseTransaction,
        amount: details.amountReceived,
        details,
      });
    }

    if (type === 'SPARK_LIGHTNING' && direction === 'SEND') {
      const sendData = SparkLightningSendDataSchema.parse(
        decryptedTransactionDetails,
      );
      const nonSensitiveSendData =
        SparkLightningSendNonSensitiveDataSchema.parse(
          data.transaction_details,
        );

      if (state === 'COMPLETED') {
        const details =
          CompletedSparkLightningSendTransactionDetailsSchema.parse({
            amountToReceive: sendData.amountToReceive,
            estimatedFee: sendData.estimatedLightningFee,
            paymentRequest: sendData.paymentRequest,
            // zod parse will do a runtime check that will make sure that amountSpent, sparkId, sparkTransferId, fee and paymentPreimage are not undefined
            amountSpent: sendData.amountSpent as Money,
            sparkId: nonSensitiveSendData.sparkId as string,
            sparkTransferId: nonSensitiveSendData.sparkTransferId as string,
            fee: sendData.totalFees as Money,
            paymentPreimage: sendData.paymentPreimage as string,
          } satisfies z.input<
            typeof CompletedSparkLightningSendTransactionDetailsSchema
          >);

        return TransactionSchema.parse({
          ...baseTransaction,
          amount: details.amountSpent,
          details,
        });
      }

      const details: IncompleteSparkLightningSendTransactionDetails = {
        amountToReceive: sendData.amountToReceive,
        estimatedFee: sendData.estimatedLightningFee,
        paymentRequest: sendData.paymentRequest,
        amountSpent: sendData.amountSpent,
        sparkId: nonSensitiveSendData.sparkId,
        sparkTransferId: nonSensitiveSendData.sparkTransferId,
        fee: sendData.totalFees,
      };

      return TransactionSchema.parse({
        ...baseTransaction,
        amount:
          details.amountSpent ??
          details.amountToReceive.add(details.estimatedFee),
        details,
      });
    }

    throw new Error(
      `Unhandled transaction type: ${type}, direction: ${direction}`,
    );
  }
}

export function useTransactionRepository() {
  const encryption = useEncryption();
  return new TransactionRepository(agicashDbClient, encryption);
}
