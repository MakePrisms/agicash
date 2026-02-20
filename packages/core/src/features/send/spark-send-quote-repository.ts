import type { z } from 'zod';
import type { AgicashDb, AgicashDbSparkSendQuote } from '../../db/database';
import { SparkLightningSendDbDataSchema } from '../../db/json-models';
import type { Money } from '../../lib/money';
import type { AllUnionFieldsRequired } from '../../lib/type-utils';
import type { Encryption } from '../shared/encryption';
import { type SparkSendQuote, SparkSendQuoteSchema } from './spark-send-quote';

type Options = {
  abortSignal?: AbortSignal;
};

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

    const sendData = SparkLightningSendDbDataSchema.parse({
      paymentRequest,
      amountReceived: amount,
      estimatedLightningFee: estimatedFee,
    } satisfies z.input<typeof SparkLightningSendDbDataSchema>);

    const encryptedData = await this.encryption.encrypt(sendData);

    const query = this.db.rpc('create_spark_send_quote', {
      p_user_id: userId,
      p_account_id: accountId,
      p_currency: amount.currency,
      p_payment_hash: paymentHash,
      p_payment_request_is_amountless: paymentRequestIsAmountless,
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
    const sendData = SparkLightningSendDbDataSchema.parse({
      paymentRequest: quote.paymentRequest,
      amountReceived: quote.amount,
      estimatedLightningFee: quote.estimatedFee,
      amountSpent: quote.amount.add(fee),
      lightningFee: fee,
    } satisfies z.input<typeof SparkLightningSendDbDataSchema>);

    const encryptedData = await this.encryption.encrypt(sendData);

    const query = this.db.rpc('mark_spark_send_quote_as_pending', {
      p_quote_id: quote.id,
      p_spark_id: sparkSendRequestId,
      p_spark_transfer_id: sparkTransferId,
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
    const sendData = SparkLightningSendDbDataSchema.parse({
      paymentRequest: quote.paymentRequest,
      amountReceived: quote.amount,
      estimatedLightningFee: quote.estimatedFee,
      amountSpent: quote.amount.add(quote.fee),
      lightningFee: quote.fee,
      paymentPreimage,
    } satisfies z.input<typeof SparkLightningSendDbDataSchema>);

    const encryptedData = await this.encryption.encrypt(sendData);

    const query = this.db.rpc('complete_spark_send_quote', {
      p_quote_id: quote.id,
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
    const decryptedData = await this.encryption.decrypt(data.encrypted_data);
    const sendData = SparkLightningSendDbDataSchema.parse(decryptedData);

    // `satisfies AllUnionFieldsRequired` gives compile time safety and makes sure that all fields are present and of the correct type.
    // schema parse then is doing spark send quote invariant check at runtime. For example it makes sure that sparkId, sparkTransferId, fee and paymentPreimage are not undefined when state is COMPLETED.
    return SparkSendQuoteSchema.parse({
      id: data.id,
      sparkId: data.spark_id ?? undefined,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      amount: sendData.amountReceived,
      estimatedFee: sendData.estimatedLightningFee,
      paymentRequest: sendData.paymentRequest,
      paymentHash: data.payment_hash,
      transactionId: data.transaction_id,
      userId: data.user_id,
      accountId: data.account_id,
      version: data.version,
      paymentRequestIsAmountless: data.payment_request_is_amountless,
      state: data.state,
      sparkTransferId: data.spark_transfer_id ?? undefined,
      fee: sendData.lightningFee,
      paymentPreimage: sendData.paymentPreimage,
      failureReason: data.failure_reason ?? undefined,
    } satisfies AllUnionFieldsRequired<z.output<typeof SparkSendQuoteSchema>>);
  }
}
