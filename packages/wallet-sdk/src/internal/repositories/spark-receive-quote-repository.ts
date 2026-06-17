import { Money as MoneyClass } from '@agicash/money';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod/mini';
import type { RepositoryCreateQuoteParams } from '../../domains/spark/spark-receive-quote-core';
import type { SparkReceiveQuote } from '../../types/spark';
import { classify } from '../classify';
import type { EncryptionService } from '../crypto/encryption';
import { CashuTokenMeltDataSchema } from '../db/cashu-token-melt-data';
import type { AgicashDbSparkReceiveQuote, Database } from '../db/database';
import { SparkLightningReceiveDbDataSchema } from '../db/spark-receive-quote-db-data';

// ---------------------------------------------------------------------------
// SparkReceiveQuoteSchema — ported from app/features/receive/spark-receive-quote.ts.
// Discriminated on BOTH `type` (LIGHTNING|CASHU_TOKEN) AND `state`.
// ---------------------------------------------------------------------------

const SparkReceiveQuoteBaseSchema = z.object({
  id: z.string(),
  sparkId: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  amount: z.instanceof(MoneyClass),
  description: z.optional(z.string()),
  paymentRequest: z.string(),
  paymentHash: z.string(),
  receiverIdentityPubkey: z.optional(z.string()),
  transactionId: z.string(),
  userId: z.string(),
  accountId: z.string(),
  totalFee: z.instanceof(MoneyClass),
  version: z.number(),
});

const SparkReceiveQuoteLightningTypeSchema = z.object({
  type: z.literal('LIGHTNING'),
});

const SparkReceiveQuoteCashuTokenTypeSchema = z.object({
  type: z.literal('CASHU_TOKEN'),
  tokenReceiveData: CashuTokenMeltDataSchema,
});

const SparkReceiveQuoteUnpaidExpiredStateSchema = z.object({
  state: z.enum(['UNPAID', 'EXPIRED']),
});

const SparkReceiveQuotePaidStateSchema = z.object({
  state: z.literal('PAID'),
  paymentPreimage: z.string(),
  sparkTransferId: z.string(),
});

const SparkReceiveQuoteFailedStateSchema = z.object({
  state: z.literal('FAILED'),
  failureReason: z.string(),
});

const SparkReceiveQuoteSchema = z.intersection(
  SparkReceiveQuoteBaseSchema,
  z.intersection(
    z.union([
      SparkReceiveQuoteLightningTypeSchema,
      SparkReceiveQuoteCashuTokenTypeSchema,
    ]),
    z.union([
      SparkReceiveQuoteUnpaidExpiredStateSchema,
      SparkReceiveQuotePaidStateSchema,
      SparkReceiveQuoteFailedStateSchema,
    ]),
  ),
);

// Compile-time check: schema output must be assignable to the contract type.
type _SchemaFitsContract = z.infer<
  typeof SparkReceiveQuoteSchema
> extends SparkReceiveQuote
  ? true
  : never;
const _check: _SchemaFitsContract = true;
void _check;

// ---------------------------------------------------------------------------
// Public input type + repository
// ---------------------------------------------------------------------------

type CreateQuoteParams = RepositoryCreateQuoteParams;

type Options = { abortSignal?: AbortSignal };

/** Data access for `wallet.spark_receive_quotes`. */
export class SparkReceiveQuoteRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Creates a spark receive quote.
   * @returns Created spark receive quote.
   */
  async create(
    params: CreateQuoteParams,
    options?: Options,
  ): Promise<SparkReceiveQuote> {
    const {
      userId,
      accountId,
      amount,
      paymentRequest,
      paymentHash,
      expiresAt,
      sparkId,
      receiverIdentityPubkey,
      receiveType,
      description,
      totalFee,
    } = params;

    const receiveData = SparkLightningReceiveDbDataSchema.parse({
      paymentRequest,
      amountReceived: amount,
      description,
      cashuTokenMeltData:
        receiveType === 'CASHU_TOKEN' ? params.meltData : undefined,
      totalFee,
    });

    const encryption = await this.encryption.get();
    const encryptedData = await encryption.encrypt(receiveData);

    const query = this.db.rpc('create_spark_receive_quote', {
      p_user_id: userId,
      p_account_id: accountId,
      p_currency: amount.currency,
      p_payment_hash: paymentHash,
      p_expires_at: expiresAt,
      p_spark_id: sparkId,
      p_receiver_identity_pubkey: receiverIdentityPubkey ?? null,
      p_receive_type: receiveType,
      p_encrypted_data: encryptedData,
      p_purpose: params.purpose,
      p_transfer_id: params.transferId,
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
   * Completes a spark receive quote by marking it as paid.
   * @returns The updated quote.
   */
  async complete(
    {
      quote,
      paymentPreimage,
      sparkTransferId,
    }: {
      /** The spark receive quote to complete. */
      quote: SparkReceiveQuote;
      /** Payment preimage of the lightning payment. */
      paymentPreimage: string;
      /** ID of the transfer in Spark system. */
      sparkTransferId: string;
    },
    options?: Options,
  ): Promise<SparkReceiveQuote> {
    const cashuTokenMeltData =
      quote.type === 'CASHU_TOKEN'
        ? {
            tokenMintUrl: quote.tokenReceiveData.sourceMintUrl,
            meltQuoteId: quote.tokenReceiveData.meltQuoteId,
            tokenAmount: quote.tokenReceiveData.tokenAmount,
            tokenProofs: quote.tokenReceiveData.tokenProofs,
            cashuReceiveFee: quote.tokenReceiveData.cashuReceiveFee,
            lightningFeeReserve: quote.tokenReceiveData.lightningFeeReserve,
          }
        : undefined;

    const receiveData = SparkLightningReceiveDbDataSchema.parse({
      paymentRequest: quote.paymentRequest,
      amountReceived: quote.amount,
      description: quote.description,
      cashuTokenMeltData,
      totalFee: quote.totalFee,
      paymentPreimage,
    });

    const encryption = await this.encryption.get();
    const encryptedData = await encryption.encrypt(receiveData);

    const query = this.db.rpc('complete_spark_receive_quote', {
      p_quote_id: quote.id,
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
   * Expires a spark receive quote.
   * @returns The updated quote.
   */
  async expire(quoteId: string, options?: Options): Promise<SparkReceiveQuote> {
    const query = this.db.rpc('expire_spark_receive_quote', {
      p_quote_id: quoteId,
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
   * Fails the spark receive quote by setting the state to FAILED.
   */
  async fail(
    { id, reason }: { id: string; reason: string },
    options?: Options,
  ): Promise<void> {
    const query = this.db.rpc('fail_spark_receive_quote', {
      p_quote_id: id,
      p_failure_reason: reason,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { error } = await query;

    if (error) {
      throw classify(error);
    }
  }

  /**
   * Marks the melt as initiated for a CASHU_TOKEN type spark receive quote.
   */
  async markMeltInitiated(
    quote: SparkReceiveQuote & { type: 'CASHU_TOKEN' },
    options?: Options,
  ): Promise<SparkReceiveQuote & { type: 'CASHU_TOKEN' }> {
    const query = this.db.rpc(
      'mark_spark_receive_quote_cashu_token_melt_initiated',
      {
        p_quote_id: quote.id,
      },
    );

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw classify(error);
    }

    const updatedQuote = await this.toQuote(data);

    return updatedQuote as SparkReceiveQuote & { type: 'CASHU_TOKEN' };
  }

  /**
   * Gets the spark receive quote with the given id.
   * @returns The spark receive quote or null if it does not exist.
   */
  async get(id: string, options?: Options): Promise<SparkReceiveQuote | null> {
    const query = this.db.from('spark_receive_quotes').select().eq('id', id);

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
   * Gets all pending (UNPAID) spark receive quotes for the given user.
   * @returns The spark receive quotes.
   */
  async getPending(
    userId: string,
    options?: Options,
  ): Promise<SparkReceiveQuote[]> {
    const query = this.db
      .from('spark_receive_quotes')
      .select()
      .eq('user_id', userId)
      .eq('state', 'UNPAID');

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
    data: AgicashDbSparkReceiveQuote,
  ): Promise<SparkReceiveQuote> {
    const encryption = await this.encryption.get();
    const decryptedData = await encryption.decrypt(data.encrypted_data);
    const receiveData = SparkLightningReceiveDbDataSchema.parse(decryptedData);

    return SparkReceiveQuoteSchema.parse({
      id: data.id,
      sparkId: data.spark_id,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      amount: receiveData.amountReceived,
      paymentRequest: receiveData.paymentRequest,
      paymentHash: data.payment_hash,
      receiverIdentityPubkey: data.receiver_identity_pubkey ?? undefined,
      transactionId: data.transaction_id,
      userId: data.user_id,
      accountId: data.account_id,
      description: receiveData.description,
      totalFee: receiveData.totalFee,
      version: data.version,
      type: data.type,
      state: data.state,
      paymentPreimage: receiveData.paymentPreimage,
      sparkTransferId: data.spark_transfer_id,
      failureReason: data.failure_reason ?? undefined,
      tokenReceiveData: receiveData.cashuTokenMeltData
        ? {
            sourceMintUrl: receiveData.cashuTokenMeltData.tokenMintUrl,
            tokenAmount: receiveData.cashuTokenMeltData.tokenAmount,
            tokenProofs: receiveData.cashuTokenMeltData.tokenProofs,
            meltQuoteId: receiveData.cashuTokenMeltData.meltQuoteId,
            // cashu_token_melt_initiated is not null when type is CASHU_TOKEN
            meltInitiated: data.cashu_token_melt_initiated as boolean,
            cashuReceiveFee: receiveData.cashuTokenMeltData.cashuReceiveFee,
            lightningFeeReserve:
              receiveData.cashuTokenMeltData.lightningFeeReserve,
          }
        : undefined,
    });
  }
}
