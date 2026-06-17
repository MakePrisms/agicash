import type { Money } from '@agicash/money';
import { Money as MoneyClass } from '@agicash/money';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod/mini';
import { DomainError } from '../../errors';
import type { SparkSendQuote } from '../../types/spark';
import type { TransactionPurpose } from '../../types/transaction';
import { classify } from '../classify';
import type { EncryptionService } from '../crypto/encryption';
import type { AgicashDbSparkSendQuote, Database } from '../db/database';
import { SparkLightningSendDbDataSchema } from '../db/spark-send-quote-db-data';

// ---------------------------------------------------------------------------
// SparkSendQuoteSchema — ported from app/features/send/spark-send-quote.ts.
// ---------------------------------------------------------------------------

const SparkSendQuoteBaseSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  expiresAt: z.nullish(z.string()),
  amount: z.instanceof(MoneyClass),
  estimatedFee: z.instanceof(MoneyClass),
  paymentRequest: z.string(),
  paymentHash: z.string(),
  transactionId: z.string(),
  userId: z.string(),
  accountId: z.string(),
  version: z.number(),
  paymentRequestIsAmountless: z.boolean(),
});

const SparkSendQuoteSchema = z.intersection(
  SparkSendQuoteBaseSchema,
  z.union([
    z.object({ state: z.literal('UNPAID') }),
    z.object({
      state: z.literal('PENDING'),
      sparkId: z.string(),
      sparkTransferId: z.string(),
      fee: z.instanceof(MoneyClass),
    }),
    z.object({
      state: z.literal('COMPLETED'),
      sparkId: z.string(),
      sparkTransferId: z.string(),
      fee: z.instanceof(MoneyClass),
      paymentPreimage: z.string(),
    }),
    z.object({
      state: z.literal('FAILED'),
      failureReason: z.string(),
      sparkId: z.optional(z.string()),
      sparkTransferId: z.optional(z.string()),
      fee: z.optional(z.instanceof(MoneyClass)),
    }),
  ]),
);

// Compile-time check: schema output must be assignable to the contract type.
type _SchemaFitsContract = z.infer<
  typeof SparkSendQuoteSchema
> extends SparkSendQuote
  ? true
  : never;
const _check: _SchemaFitsContract = true;
void _check;

// ---------------------------------------------------------------------------
// Public input types + repository
// ---------------------------------------------------------------------------

type Options = { abortSignal?: AbortSignal };

export type CreateQuoteParams = {
  /** ID of the sending user. */
  userId: string;
  /** ID of the sending account. */
  accountId: string;
  /** Amount being sent. Doesn't include the fee. */
  amount: Money;
  /** Estimated fee for the lightning payment. */
  estimatedFee: Money;
  /** Lightning payment request being paid. */
  paymentRequest: string;
  /** Payment hash of the lightning invoice. */
  paymentHash: string;
  /** Whether the payment request is amountless. */
  paymentRequestIsAmountless: boolean;
  /** Expiry of the lightning invoice in ISO 8601 format. */
  expiresAt?: Date | null;
  /** The purpose of this transaction. */
  purpose?: TransactionPurpose;
  /** UUID linking paired send/receive transactions in a transfer. */
  transferId?: string;
};

/** Data access for `wallet.spark_send_quotes`. */
export class SparkSendQuoteRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Creates a spark send quote.
   * @returns Created spark send quote.
   * @throws {DomainError} code `duplicate` when the invoice is already being processed.
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
    });

    const encryption = await this.encryption.get();
    const encryptedData = await encryption.encrypt(sendData);

    const query = this.db.rpc('create_spark_send_quote', {
      p_user_id: userId,
      p_account_id: accountId,
      p_currency: amount.currency,
      p_payment_hash: paymentHash,
      p_payment_request_is_amountless: paymentRequestIsAmountless,
      p_encrypted_data: encryptedData,
      p_expires_at: expiresAt?.toISOString(),
      p_purpose: params.purpose,
      p_transfer_id: params.transferId,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      if (error.code === '23505') {
        // Hits the spark_send_quotes_payment_hash_active_unique partial index,
        // which covers UNPAID, PENDING, and COMPLETED — so the existing quote
        // could be in any of those states.
        throw new DomainError(
          'A payment for this invoice is already being processed or was completed',
          'duplicate',
        );
      }
      throw classify(error);
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
      /** Spark send quote to mark as pending. */
      quote: SparkSendQuote;
      /** ID of the spark send request in spark system. */
      sparkSendRequestId: string;
      /** ID of the transfer in Spark system. */
      sparkTransferId: string;
      /** Actual fee for the lightning payment. */
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
    });

    const encryption = await this.encryption.get();
    const encryptedData = await encryption.encrypt(sendData);

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
      throw classify(error);
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
      /** The spark send quote to complete. */
      quote: SparkSendQuote & { state: 'PENDING' };
      /** Payment preimage from the lightning payment. */
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
    });

    const encryption = await this.encryption.get();
    const encryptedData = await encryption.encrypt(sendData);

    const query = this.db.rpc('complete_spark_send_quote', {
      p_quote_id: quote.id,
      p_encrypted_data: encryptedData,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw classify(error);
    }

    return this.toQuote(data);
  }

  /**
   * Fails a spark send quote.
   * @returns The updated quote.
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
      throw classify(error);
    }

    return this.toQuote(data);
  }

  /**
   * Gets the spark send quote with the given id.
   * @returns The spark send quote or null if it does not exist.
   */
  async get(id: string, options?: Options): Promise<SparkSendQuote | null> {
    const query = this.db.from('spark_send_quotes').select().eq('id', id);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw classify(error);
    }

    return data ? this.toQuote(data) : null;
  }

  /**
   * Gets all unresolved (UNPAID or PENDING) spark send quotes for the given user.
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
      throw classify(error);
    }

    return Promise.all((data ?? []).map((row) => this.toQuote(row)));
  }

  private async toQuote(
    data: AgicashDbSparkSendQuote,
  ): Promise<SparkSendQuote> {
    const encryption = await this.encryption.get();
    const decryptedData = await encryption.decrypt(data.encrypted_data);
    const sendData = SparkLightningSendDbDataSchema.parse(decryptedData);

    return SparkSendQuoteSchema.parse({
      id: data.id,
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
      sparkId: data.spark_id ?? undefined,
      sparkTransferId: data.spark_transfer_id ?? undefined,
      fee: sendData.lightningFee,
      paymentPreimage: sendData.paymentPreimage,
      failureReason: data.failure_reason ?? undefined,
    });
  }
}
