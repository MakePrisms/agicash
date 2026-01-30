import type { z } from 'zod';
import type { AllUnionFieldsRequired } from '~/lib/type-utils';
import type {
  AgicashDb,
  AgicashDbSparkReceiveQuote,
} from '../agicash-db/database';
import { agicashDbClient } from '../agicash-db/database.client';
import { SparkLightningReceiveDbDataSchema } from '../agicash-db/json-models';
import { type Encryption, useEncryption } from '../shared/encryption';
import {
  type SparkReceiveQuote,
  SparkReceiveQuoteSchema,
} from './spark-receive-quote';
import type { RepositoryCreateQuoteParams } from './spark-receive-quote-core';

type Options = {
  abortSignal?: AbortSignal;
};

type CreateQuoteParams = RepositoryCreateQuoteParams;

export class SparkReceiveQuoteRepository {
  constructor(
    private readonly db: AgicashDb,
    private readonly encryption: Encryption,
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
    } satisfies z.input<typeof SparkLightningReceiveDbDataSchema>);

    const encryptedData = await this.encryption.encrypt(receiveData);

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
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to create spark receive quote', { cause: error });
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
      /**
       * The spark receive quote to complete.
       */
      quote: SparkReceiveQuote;
      /**
       * Payment preimage of the lightning payment.
       */
      paymentPreimage: string;
      /**
       * ID of the transfer in Spark system.
       */
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
    } satisfies z.input<typeof SparkLightningReceiveDbDataSchema>);

    const encryptedData = await this.encryption.encrypt(receiveData);

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
      throw new Error('Failed to complete spark receive quote', {
        cause: error,
      });
    }

    return this.toQuote(data);
  }

  /**
   * Expires a spark receive quote.
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
      throw new Error('Failed to expire spark receive quote', { cause: error });
    }

    return this.toQuote(data);
  }

  /**
   * Fails the spark receive quote by setting the state to FAILED.
   * @throws An error if failing the quote fails.
   */
  async fail(
    {
      id,
      reason,
    }: {
      /**
       * ID of the spark receive quote.
       */
      id: string;
      /**
       * Reason for the failure.
       */
      reason: string;
    },
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
      throw new Error('Failed to fail spark receive quote', { cause: error });
    }
  }

  /**
   * Marks the melt as initiated for a CASHU_TOKEN type spark receive quote.
   * This sets the cashu_token_melt_initiated column to true.
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
      throw new Error('Failed to mark melt initiated for spark receive quote', {
        cause: error,
      });
    }

    const updatedQuote = await this.toQuote(data);

    return updatedQuote as SparkReceiveQuote & {
      type: 'CASHU_TOKEN';
    };
  }

  /**
   * Gets the spark receive quote with the given id.
   * @param id - The id of the spark receive quote to get.
   * @returns The spark receive quote or null if it does not exist.
   */
  async get(id: string, options?: Options): Promise<SparkReceiveQuote | null> {
    const query = this.db.from('spark_receive_quotes').select().eq('id', id);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to get spark receive quote', { cause: error });
    }

    return data ? this.toQuote(data) : null;
  }

  /**
   * Gets all pending (unpaid) spark receive quotes for the given user.
   * @param userId - The id of the user to get the spark receive quotes for.
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
      throw new Error('Failed to get spark receive quotes', { cause: error });
    }

    return Promise.all(data.map((data) => this.toQuote(data)));
  }

  async toQuote(data: AgicashDbSparkReceiveQuote): Promise<SparkReceiveQuote> {
    const decryptedData = await this.encryption.decrypt(data.encrypted_data);
    const receiveData = SparkLightningReceiveDbDataSchema.parse(decryptedData);

    // `satisfies AllUnionFieldsRequired` gives compile time safety and makes sure that all fields are present and of the correct type.
    // schema parse then is doing spark receive quote invariant check at runtime. For example it makes sure that tokenReceiveData is present when type is CASHU_TOKEN, etc.
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
      version: data.version,
      description: receiveData.description,
      totalFee: receiveData.totalFee,
      type: data.type,
      state: data.state,
      paymentPreimage: receiveData.paymentPreimage,
      sparkTransferId: data.spark_transfer_id,
      failureReason: data.failure_reason,
      tokenReceiveData: receiveData.cashuTokenMeltData
        ? {
            sourceMintUrl: receiveData.cashuTokenMeltData.tokenMintUrl,
            tokenAmount: receiveData.cashuTokenMeltData.tokenAmount,
            tokenProofs: receiveData.cashuTokenMeltData.tokenProofs,
            meltQuoteId: receiveData.cashuTokenMeltData.meltQuoteId,
            // zod parse will do a runtime check that will make sure that cashu_token_melt_initiated is not null when type is CASHU_TOKEN
            meltInitiated: data.cashu_token_melt_initiated as boolean,
            cashuReceiveFee: receiveData.cashuTokenMeltData.cashuReceiveFee,
            lightningFeeReserve:
              receiveData.cashuTokenMeltData.lightningFeeReserve,
          }
        : undefined,
    } satisfies AllUnionFieldsRequired<
      z.output<typeof SparkReceiveQuoteSchema>
    >);
  }
}

export function useSparkReceiveQuoteRepository() {
  const encryption = useEncryption();
  return new SparkReceiveQuoteRepository(agicashDbClient, encryption);
}
