import type { z } from 'zod';
import type { Money } from '~/lib/money';
import type { AgicashDb } from '../agicash-db/database';
import { SparkLightningReceiveDbDataSchema } from '../agicash-db/json-models';
import { encryptToPublicKey } from '../shared/encryption';
import type { SparkReceiveQuote } from './spark-receive-quote';
import type { RepositoryCreateQuoteParams } from './spark-receive-quote-core';

type Options = {
  abortSignal?: AbortSignal;
};

/**
 * Minimal data returned after creating a spark receive quote on the server.
 * Server doesn't have access to user's private key to decrypt full quote data.
 */
export type SparkReceiveQuoteCreated = {
  id: string;
  sparkId: string;
  paymentRequest: string;
  paymentHash: string;
  expiresAt: string;
  receiveType: SparkReceiveQuote['type'];
  amount: Money;
  totalFee: Money;
  description?: string;
};

type CreateQuoteParams = RepositoryCreateQuoteParams & {
  /**
   * Public key used to encrypt data for the user.
   */
  userEncryptionPublicKey: string;
};

/**
 * Server-side repository for creating spark receive quotes.
 * This repository only supports creating quotes and returns minimal data.
 * It encrypts data to the user's public key but cannot decrypt.
 */
export class SparkReceiveQuoteRepositoryServer {
  constructor(private readonly db: AgicashDb) {}

  /**
   * Creates a spark receive quote.
   * @returns Minimal quote data (id, sparkId, paymentRequest, paymentHash, expiresAt).
   */
  async create(
    params: CreateQuoteParams,
    options?: Options,
  ): Promise<SparkReceiveQuoteCreated> {
    const {
      userId,
      userEncryptionPublicKey,
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

    const encryptedData = encryptToPublicKey(
      receiveData,
      userEncryptionPublicKey,
    );

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

    return {
      id: data.id,
      receiveType,
      sparkId: data.spark_id,
      paymentRequest,
      paymentHash,
      expiresAt,
      amount,
      totalFee,
      description,
    };
  }
}
