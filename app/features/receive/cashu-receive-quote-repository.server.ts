import type { z } from 'zod';
import type { Money } from '~/lib/money';
import { computeSHA256 } from '~/lib/sha256';
import type { AgicashDb } from '../agicash-db/database';
import { CashuLightningReceiveDbDataSchema } from '../agicash-db/json-models';
import { encryptToPublicKey } from '../shared/encryption';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import type { RepositoryCreateQuoteParams } from './cashu-receive-quote-core';

/**
 * Minimal data returned by the server-side repository after creating a quote.
 * This avoids exposing sensitive data that requires decryption on the server.
 */
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
  /**
   * The user's encryption public key. Used to encrypt data on the server before storage.
   */
  userEncryptionPublicKey: string;
};

type Options = {
  abortSignal?: AbortSignal;
};

/**
 * Server-side repository for Cashu receive quotes.
 * Can only create quotes (not read/decrypt them) since the server doesn't have the user's private key.
 */
export class CashuReceiveQuoteRepositoryServer {
  constructor(private readonly db: AgicashDb) {}

  /**
   * Creates a cashu receive quote on the server.
   * Encrypts data using the user's public key before storage.
   * @returns Minimal quote data without requiring decryption.
   */
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
      encryptToPublicKey(receiveData, userEncryptionPublicKey),
      computeSHA256(quoteId),
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

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to create cashu receive quote', { cause: error });
    }

    return {
      id: data.id,
      quoteId,
      paymentRequest,
      paymentHash,
      expiresAt,
      type: receiveType,
      amount,
      mintingFee: params.mintingFee,
      description,
    };
  }
}
