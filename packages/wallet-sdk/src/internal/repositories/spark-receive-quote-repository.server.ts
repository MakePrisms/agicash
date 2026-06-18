import type { Money } from '@agicash/money';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod/mini';
import type { RepositoryCreateQuoteParams } from '../../domains/spark/spark-receive-quote-core';
import type { SparkReceiveQuote } from '../../types/spark';
import { classify } from '../classify';
import { encryptToPublicKey } from '../crypto/encryption';
import type { Database } from '../db/database';
import { SparkLightningReceiveDbDataSchema } from '../db/spark-receive-quote-db-data';

/** Minimal data returned after creating a spark receive quote server-side (no decrypt). */
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
  /** The receiving user's encryption public key; the stored data is ECIES-encrypted to it. */
  userEncryptionPublicKey: string;
};

type Options = { abortSignal?: AbortSignal };

/**
 * Server-side spark receive-quote repository: create-only. Encrypts the stored
 * receiveData to the RECEIVING user's public key (the server has no per-user
 * private key) and returns minimal data — it cannot decrypt existing quotes.
 */
export class SparkReceiveQuoteRepositoryServer {
  constructor(private readonly db: SupabaseClient<Database>) {}

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
    if (options?.abortSignal) query.abortSignal(options.abortSignal);

    const { data, error } = await query;
    if (error) throw classify(error);

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
