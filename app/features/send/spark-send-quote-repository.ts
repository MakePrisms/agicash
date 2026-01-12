import type { Money } from '~/lib/money';
import type {
  AgicashDb,
  AgicashDbSparkSendQuote,
} from '../agicash-db/database';
import { agicashDbClient } from '../agicash-db/database.client';
import { type Encryption, useEncryption } from '../shared/encryption';
import type {
  CompletedSparkLightningSendTransactionDetails,
  IncompleteSparkLightningSendTransactionDetails,
} from '../transactions/transaction';
import type { SparkSendQuote } from './spark-send-quote';

type Options = {
  abortSignal?: AbortSignal;
};

type EncryptedDataUnpaid = Pick<
  IncompleteSparkLightningSendTransactionDetails,
  'amountToReceive' | 'estimatedFee' | 'paymentRequest'
>;
type EncryptedDataPending =
  Required<IncompleteSparkLightningSendTransactionDetails>;
type EncryptedDataCompleted = CompletedSparkLightningSendTransactionDetails;

type CreateQuoteParams = {
  /**
   * ID of the sending user.
   */
  userId: string;
  /**
   * ID of the sending account.
   */
  accountId: string;
  /**
   * Amount being sent. Doesn't include the fee.
   */
  amount: Money;
  /**
   * Estimated fee for the lightning payment.
   */
  estimatedFee: Money;
  /**
   * Lightning payment request being paid.
   */
  paymentRequest: string;
  /**
   * Payment hash of the lightning invoice.
   */
  paymentHash: string;
  /**
   * Whether the payment request is amountless.
   */
  paymentRequestIsAmountless: boolean;
  /**
   * Expiry of the lightning invoice in ISO 8601 format.
   */
  expiresAt?: Date | null;
};

export class SparkSendQuoteRepository {
  constructor(
    private readonly db: AgicashDb,
    private readonly encryption: Encryption,
  ) {}

  /**
   * Creates a spark send quote.
   * @returns Created spark send quote.
   */
  async create(
    params: CreateQuoteParams,
    options?: Options,
  ): Promise<SparkSendQuote> {
    const {
      userId,
      accountId,
      amount,
      estimatedFee,
      paymentRequest,
      paymentHash,
      paymentRequestIsAmountless,
      expiresAt,
    } = params;

    const dataToEncrypt: EncryptedDataUnpaid = {
      amountToReceive: amount,
      estimatedFee,
      paymentRequest,
    };

    const encryptedData = await this.encryption.encrypt(dataToEncrypt);

    const query = this.db.rpc('create_spark_send_quote', {
      p_user_id: userId,
      p_account_id: accountId,
      p_currency: amount.currency,
      p_payment_hash: paymentHash,
      p_payment_request_is_amountless: paymentRequestIsAmountless,
      p_encrypted_transaction_details: encryptedData,
      p_encrypted_data: encryptedData,
      p_expires_at: expiresAt?.toISOString(),
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to create spark send quote', { cause: error });
    }

    return this.toQuote(data);
  }

  /**
   * Marks a spark send quote as pending and sets the spark_id and the actual fee.
   * @returns The updated quote.
   */
  async markAsPending(
    {
      quote,
      fee,
      sparkSendRequestId,
      sparkTransferId,
    }: {
      /**
       * Spark send quote to mark as pending.
       */
      quote: SparkSendQuote;
      /**
       * ID of the spark send request in spark system.
       */
      sparkSendRequestId: string;
      /**
       * ID of the transfer in Spark system.
       */
      sparkTransferId: string;
      /**
       * Actual fee for the lightning payment.
       */
      fee: Money;
    },
    options?: Options,
  ): Promise<SparkSendQuote> {
    const dataToEncrypt: EncryptedDataPending = {
      amountToReceive: quote.amount,
      amountSpent: quote.amount.add(fee),
      estimatedFee: quote.estimatedFee,
      paymentRequest: quote.paymentRequest,
      sparkId: sparkSendRequestId,
      sparkTransferId: sparkTransferId,
      fee,
    };

    const encryptedData = await this.encryption.encrypt(dataToEncrypt);

    const query = this.db.rpc('mark_spark_send_quote_as_pending', {
      p_quote_id: quote.id,
      p_spark_id: sparkSendRequestId,
      p_spark_transfer_id: sparkTransferId,
      p_encrypted_transaction_details: encryptedData,
      p_encrypted_data: encryptedData,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to mark spark send quote as pending', {
        cause: error,
      });
    }

    return this.toQuote(data);
  }

  /**
   * Completes a spark send quote by marking it as completed.
   * @returns The updated quote.
   */
  async complete(
    {
      quote,
      paymentPreimage,
    }: {
      /**
       * The spark send quote to complete.
       */
      quote: SparkSendQuote & { state: 'PENDING' };
      /**
       * Payment preimage from the lightning payment.
       */
      paymentPreimage: string;
    },
    options?: Options,
  ): Promise<SparkSendQuote> {
    const dataToEncrypt: EncryptedDataCompleted = {
      amountToReceive: quote.amount,
      amountSpent: quote.amount.add(quote.fee),
      estimatedFee: quote.estimatedFee,
      paymentRequest: quote.paymentRequest,
      fee: quote.fee,
      sparkId: quote.sparkId,
      sparkTransferId: quote.sparkTransferId,
      paymentPreimage,
    };

    const encryptedData = await this.encryption.encrypt(dataToEncrypt);

    const query = this.db.rpc('complete_spark_send_quote', {
      p_quote_id: quote.id,
      p_encrypted_transaction_details: encryptedData,
      p_encrypted_data: encryptedData,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to complete spark send quote', {
        cause: error,
      });
    }

    return this.toQuote(data);
  }

  /**
   * Fails a spark send quote.
   */
  async fail(
    quoteId: string,
    failureReason: string,
    options?: Options,
  ): Promise<SparkSendQuote> {
    const query = this.db.rpc('fail_spark_send_quote', {
      p_quote_id: quoteId,
      p_failure_reason: failureReason,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to fail spark send quote', { cause: error });
    }

    return this.toQuote(data);
  }

  /**
   * Gets the spark send quote with the given id.
   * @param id - The id of the spark send quote to get.
   * @returns The spark send quote or null if it does not exist.
   */
  async get(id: string, options?: Options): Promise<SparkSendQuote | null> {
    const query = this.db.from('spark_send_quotes').select().eq('id', id);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to get spark send quote', { cause: error });
    }

    return data ? this.toQuote(data) : null;
  }

  /**
   * Gets all unresolved (UNPAID or PENDING) spark send quotes for the given user.
   * @param userId - The id of the user to get the spark send quotes for.
   * @returns The spark send quotes.
   */
  async getUnresolved(
    userId: string,
    options?: Options,
  ): Promise<SparkSendQuote[]> {
    const query = this.db
      .from('spark_send_quotes')
      .select()
      .eq('user_id', userId)
      .in('state', ['UNPAID', 'PENDING']);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to get spark send quotes', { cause: error });
    }

    return Promise.all(data.map((data) => this.toQuote(data)));
  }

  async toQuote(data: AgicashDbSparkSendQuote): Promise<SparkSendQuote> {
    if (data.state === 'UNPAID') {
      return this.decryptUnpaidQuote(data);
    }
    if (data.state === 'PENDING') {
      return this.decryptPendingQuote(data);
    }
    if (data.state === 'COMPLETED') {
      return this.decryptCompletedQuote(data);
    }
    if (data.state === 'FAILED') {
      return this.decryptFailedQuote(data);
    }

    throw new Error(`Unexpected quote state ${data.state}`);
  }

  private async decryptUnpaidQuote(
    data: AgicashDbSparkSendQuote,
  ): Promise<SparkSendQuote & { state: 'UNPAID' }> {
    const [decryptedData] = await this.encryption.decryptBatch<
      [EncryptedDataUnpaid]
    >([data.encrypted_data]);

    return {
      id: data.id,
      state: 'UNPAID',
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      amount: decryptedData.amountToReceive,
      estimatedFee: decryptedData.estimatedFee,
      paymentRequest: decryptedData.paymentRequest,
      paymentHash: data.payment_hash,
      transactionId: data.transaction_id,
      userId: data.user_id,
      accountId: data.account_id,
      version: data.version,
      paymentRequestIsAmountless: data.payment_request_is_amountless,
    };
  }

  private async decryptPendingQuote(
    data: AgicashDbSparkSendQuote,
  ): Promise<SparkSendQuote & { state: 'PENDING' }> {
    const [decryptedData] = await this.encryption.decryptBatch<
      [EncryptedDataPending]
    >([data.encrypted_data]);

    if (!data.spark_id) {
      throw new Error(
        'Invalid spark send quote data. Spark id is required for pending state.',
      );
    }
    if (!data.spark_transfer_id) {
      throw new Error(
        'Invalid spark send quote data. Spark transfer id is required for pending state.',
      );
    }

    return {
      id: data.id,
      state: 'PENDING',
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      amount: decryptedData.amountToReceive,
      estimatedFee: decryptedData.estimatedFee,
      paymentRequest: decryptedData.paymentRequest,
      paymentHash: data.payment_hash,
      transactionId: data.transaction_id,
      userId: data.user_id,
      accountId: data.account_id,
      version: data.version,
      paymentRequestIsAmountless: data.payment_request_is_amountless,
      sparkId: data.spark_id,
      sparkTransferId: data.spark_transfer_id,
      fee: decryptedData.fee,
    };
  }

  private async decryptCompletedQuote(
    data: AgicashDbSparkSendQuote,
  ): Promise<SparkSendQuote & { state: 'COMPLETED' }> {
    const [decryptedData] = await this.encryption.decryptBatch<
      [EncryptedDataCompleted]
    >([data.encrypted_data]);

    if (!data.spark_id) {
      throw new Error(
        'Invalid spark send quote data. Spark id is required for completed state.',
      );
    }
    if (!data.spark_transfer_id) {
      throw new Error(
        'Invalid spark send quote data. Spark transfer id is required for completed state.',
      );
    }

    return {
      id: data.id,
      state: 'COMPLETED',
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      amount: decryptedData.amountToReceive,
      estimatedFee: decryptedData.estimatedFee,
      paymentRequest: decryptedData.paymentRequest,
      paymentHash: data.payment_hash,
      transactionId: data.transaction_id,
      userId: data.user_id,
      accountId: data.account_id,
      version: data.version,
      paymentRequestIsAmountless: data.payment_request_is_amountless,
      sparkId: data.spark_id,
      sparkTransferId: data.spark_transfer_id,
      fee: decryptedData.fee,
      paymentPreimage: decryptedData.paymentPreimage,
    };
  }

  private async decryptFailedQuote(
    data: AgicashDbSparkSendQuote,
  ): Promise<SparkSendQuote & { state: 'FAILED' }> {
    const [decryptedData] = await this.encryption.decryptBatch<
      [EncryptedDataPending | EncryptedDataUnpaid]
    >([data.encrypted_data]);

    return {
      id: data.id,
      state: 'FAILED',
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      amount: decryptedData.amountToReceive,
      estimatedFee: decryptedData.estimatedFee,
      paymentRequest: decryptedData.paymentRequest,
      paymentHash: data.payment_hash,
      transactionId: data.transaction_id,
      userId: data.user_id,
      accountId: data.account_id,
      version: data.version,
      paymentRequestIsAmountless: data.payment_request_is_amountless,
      failureReason: data.failure_reason ?? undefined,
      sparkId: data.spark_id ?? undefined,
      sparkTransferId: data.spark_transfer_id ?? undefined,
      fee: (decryptedData as EncryptedDataPending).fee,
    };
  }
}

export function useSparkSendQuoteRepository() {
  const encryption = useEncryption();
  return new SparkSendQuoteRepository(agicashDbClient, encryption);
}
