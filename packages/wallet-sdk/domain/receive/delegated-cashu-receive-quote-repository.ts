import type { Money } from '@agicash/money';
import { computeSHA256 } from '@agicash/utils';
import type { z } from 'zod/mini';
import type { AgicashDb } from '../../db/database';
import { CashuLightningReceiveDbDataSchema } from '../../db/json-models/cashu-lightning-receive-db-data';
import { encryptToPublicKey } from '../../lib/encryption';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import type { RepositoryCreateQuoteParams } from './cashu-receive-quote-core';

/**
 * Minimal data returned by the delegated repository after creating a quote.
 * The delegate cannot decrypt, so nothing requiring decryption is exposed.
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
   * The recipient's encryption public key. The payload is encrypted to it before storage.
   */
  userEncryptionPublicKey: string;
};

type Options = {
  abortSignal?: AbortSignal;
};

/**
 * Delegated repository for Cashu receive quotes — creates them on the recipient's behalf.
 * Can only create quotes (not read/decrypt them) since the delegate doesn't hold the recipient's private key.
 */
export class DelegatedCashuReceiveQuoteRepository {
  constructor(private readonly db: AgicashDb) {}

  /**
   * Creates a cashu receive quote on the recipient's behalf.
   * Encrypts the payload to the recipient's public key before storage.
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
