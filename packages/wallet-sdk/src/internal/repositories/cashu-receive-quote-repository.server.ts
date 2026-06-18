import type { Money } from '@agicash/money';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod/mini';
import type { RepositoryCreateQuoteParams } from '../../domains/cashu/cashu-receive-quote-core';
import type { CashuReceiveQuote } from '../../types/cashu';
import { classify } from '../classify';
import { encryptToPublicKey } from '../crypto/encryption';
import { sha256Hex } from '../crypto/sha256';
import { CashuLightningReceiveDbDataSchema } from '../db/cashu-receive-quote-db-data';
import type { Database } from '../db/database';

/** Minimal data returned after creating a cashu receive quote server-side (no decrypt). */
export type CashuReceiveQuoteCreated = {
  id: string;
  quoteId: string;
  paymentRequest: string;
  paymentHash: string;
  expiresAt: string;
  type: CashuReceiveQuote['type'];
  amount: Money;
  mintingFee?: Money;
  description?: string;
};

type CreateQuoteParams = RepositoryCreateQuoteParams & {
  userEncryptionPublicKey: string;
};

type Options = { abortSignal?: AbortSignal };

/**
 * Server-side cashu receive-quote repository: create-only. Encrypts the stored
 * receiveData to the receiving user's public key and returns minimal data.
 */
export class CashuReceiveQuoteRepositoryServer {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async create(
    params: CreateQuoteParams,
    options?: Options,
  ): Promise<CashuReceiveQuoteCreated> {
    const {
      userId,
      accountId,
      amount,
      quoteId,
      paymentRequest,
      paymentHash,
      expiresAt,
      description,
      lockingDerivationPath,
      receiveType,
      userEncryptionPublicKey,
      mintingFee,
      totalFee,
    } = params;

    const receiveData = CashuLightningReceiveDbDataSchema.parse({
      paymentRequest,
      mintQuoteId: quoteId,
      amountReceived: amount,
      description,
      mintingFee,
      cashuTokenMeltData:
        receiveType === 'CASHU_TOKEN' ? params.meltData : undefined,
      totalFee,
    } satisfies z.input<typeof CashuLightningReceiveDbDataSchema>);

    const [encryptedReceiveData, quoteIdHash] = await Promise.all([
      Promise.resolve(encryptToPublicKey(receiveData, userEncryptionPublicKey)),
      sha256Hex(quoteId),
    ]);

    const query = this.db.rpc('create_cashu_receive_quote', {
      p_user_id: userId,
      p_account_id: accountId,
      p_currency: amount.currency,
      p_expires_at: expiresAt,
      p_locking_derivation_path: lockingDerivationPath,
      p_receive_type: receiveType,
      p_encrypted_data: encryptedReceiveData,
      p_quote_id_hash: quoteIdHash,
      p_payment_hash: paymentHash,
    });
    if (options?.abortSignal) query.abortSignal(options.abortSignal);

    const { data, error } = await query;
    if (error) throw classify(error);

    return {
      id: data.id,
      quoteId,
      paymentRequest,
      paymentHash,
      expiresAt,
      type: receiveType,
      amount,
      mintingFee,
      description,
    };
  }
}
