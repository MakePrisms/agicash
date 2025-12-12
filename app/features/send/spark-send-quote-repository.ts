import { Money } from '~/lib/money';
import {
  type AgicashDb,
  type AgicashDbSparkSendQuote,
  agicashDb,
} from '../agicash-db/database';
import { getDefaultUnit } from '../shared/currencies';
import { type Encryption, useEncryption } from '../shared/encryption';
import type {
  CompletedSparkLightningSendTransactionDetails,
  SparkLightningSendTransactionDetails,
} from '../transactions/transaction';
import type { SparkSendQuote } from './spark-send-quote';

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
   * Amount being sent.
   */
  amount: Money;
  /**
   * Fee for the lightning payment.
   */
  fee: Money;
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
      fee,
      paymentRequest,
      paymentHash,
      paymentRequestIsAmountless,
    } = params;

    const unit = getDefaultUnit(amount.currency);

    const details: SparkLightningSendTransactionDetails = {
      amountSpent: amount,
      fee,
      paymentRequest,
    };

    const encryptedTransactionDetails = await this.encryption.encrypt(details);

    const query = this.db.rpc('create_spark_send_quote', {
      p_user_id: userId,
      p_account_id: accountId,
      p_amount: amount.toNumber(unit),
      p_fee: fee.toNumber(unit),
      p_currency: amount.currency,
      p_unit: unit,
      p_payment_request: paymentRequest,
      p_payment_hash: paymentHash,
      p_payment_request_is_amountless: paymentRequestIsAmountless,
      p_encrypted_transaction_details: encryptedTransactionDetails,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to create spark send quote', { cause: error });
    }

    return SparkSendQuoteRepository.toQuote(data);
  }

  /**
   * Marks a spark send quote as pending by setting the spark_id.
   * @returns The updated quote.
   */
  async markAsPending(
    quoteId: string,
    sparkRequestId: string,
    options?: Options,
  ): Promise<SparkSendQuote> {
    // TODO: we probably also need to update transaction details to include the spark_id.
    const query = this.db.rpc('mark_spark_send_quote_as_pending', {
      p_quote_id: quoteId,
      p_spark_id: sparkRequestId,
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

    return SparkSendQuoteRepository.toQuote(data);
  }

  /**
   * Completes a spark send quote by marking it as completed.
   * @returns The updated quote.
   */
  async complete(
    {
      quote,
      paymentPreimage,
      sparkTransferId,
      fee,
    }: {
      /**
       * The spark send quote to complete.
       */
      quote: SparkSendQuote;
      /**
       * Payment preimage from the lightning payment.
       */
      paymentPreimage: string;
      /**
       * Spark transfer ID from the completed transfer.
       */
      sparkTransferId: string;
      /**
       * Actual fee paid for the lightning payment.
       */
      fee: Money;
    },
    options?: Options,
  ): Promise<SparkSendQuote> {
    const unit = getDefaultUnit(fee.currency);

    // sparkTransferId is stored in non-encrypted transaction details.
    const detailsToEncrypt: Omit<
      CompletedSparkLightningSendTransactionDetails,
      'sparkTransferId'
    > = {
      amountSpent: quote.amount,
      fee,
      paymentRequest: quote.paymentRequest,
      paymentPreimage,
    };

    const encryptedTransactionDetails =
      await this.encryption.encrypt(detailsToEncrypt);

    const query = this.db.rpc('complete_spark_send_quote', {
      p_quote_id: quote.id,
      p_payment_preimage: paymentPreimage,
      p_spark_transfer_id: sparkTransferId,
      p_fee: fee.toNumber(unit),
      p_encrypted_transaction_details: encryptedTransactionDetails,
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

    return SparkSendQuoteRepository.toQuote(data);
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

    return SparkSendQuoteRepository.toQuote(data);
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

    return data ? SparkSendQuoteRepository.toQuote(data) : null;
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

    return data.map((data) => SparkSendQuoteRepository.toQuote(data));
  }

  static toQuote(data: AgicashDbSparkSendQuote): SparkSendQuote {
    const baseQuote = {
      id: data.id,
      sparkId: data.spark_id,
      createdAt: data.created_at,
      amount: new Money({
        amount: data.amount,
        currency: data.currency,
        unit: data.unit,
      }),
      fee: new Money({
        amount: data.fee,
        currency: data.currency,
        unit: data.unit,
      }),
      paymentRequest: data.payment_request,
      paymentHash: data.payment_hash,
      transactionId: data.transaction_id,
      userId: data.user_id,
      accountId: data.account_id,
      version: data.version,
      paymentRequestIsAmountless: data.payment_request_is_amountless,
    };

    if (data.state === 'COMPLETED') {
      if (!data.payment_preimage) {
        throw new Error(
          'Invalid spark send quote data. Payment preimage is required for completed state.',
        );
      }
      if (!data.spark_transfer_id) {
        throw new Error(
          'Invalid spark send quote data. Spark transfer id is required for completed state.',
        );
      }
      if (!data.spark_id) {
        throw new Error(
          'Invalid spark send quote data. Spark id is required for completed state.',
        );
      }

      return {
        ...baseQuote,
        state: 'COMPLETED',
        sparkId: data.spark_id,
        paymentPreimage: data.payment_preimage,
        sparkTransferId: data.spark_transfer_id,
      };
    }

    if (data.state === 'FAILED') {
      return {
        ...baseQuote,
        state: 'FAILED',
        failureReason: data.failure_reason ?? undefined,
      };
    }

    if (data.state === 'PENDING') {
      if (!data.spark_id) {
        throw new Error(
          'Invalid spark send quote data. Spark id is required for pending state.',
        );
      }

      return {
        ...baseQuote,
        state: 'PENDING',
        sparkId: data.spark_id,
      };
    }

    if (data.state === 'UNPAID') {
      return {
        ...baseQuote,
        state: 'UNPAID',
      };
    }

    throw new Error(`Unexpected quote state ${data.state}`);
  }
}

export function useSparkSendQuoteRepository() {
  const encryption = useEncryption();
  return new SparkSendQuoteRepository(agicashDb, encryption);
}
