import {
  type CreateQuoteBaseParams,
  type GetLightningQuoteParams,
  type SparkReceiveLightningQuote,
  computeQuoteExpiry,
  getAmountAndFee,
  getLightningQuote,
} from './spark-receive-quote-core';
import type {
  SparkReceiveQuoteCreated,
  SparkReceiveQuoteRepositoryServer,
} from './spark-receive-quote-repository.server';

// Re-export shared types for convenience
export type { SparkReceiveLightningQuote, GetLightningQuoteParams };

type CreateQuoteParams = CreateQuoteBaseParams & {
  /**
   * Public key used to encrypt data for the user.
   */
  userEncryptionPublicKey: string;
};

/**
 * Server-side service for creating spark receive quotes.
 * This service only supports getting lightning quotes and creating receive quotes.
 * It does not support reading or updating quotes (no decrypt capability).
 */
export class SparkReceiveQuoteServiceServer {
  constructor(private readonly repository: SparkReceiveQuoteRepositoryServer) {}

  /**
   * Gets a Spark lightning receive quote for the given amount.
   * @returns The Spark lightning receive quote.
   */
  async getLightningQuote(
    params: GetLightningQuoteParams,
  ): Promise<SparkReceiveLightningQuote> {
    return getLightningQuote(params);
  }

  /**
   * Creates a new Spark Lightning receive quote for the given amount.
   * This creates a lightning invoice via Spark and stores the quote in the database.
   * @returns Minimal quote data (id, sparkId, paymentRequest, paymentHash, expiresAt).
   */
  async createReceiveQuote(
    params: CreateQuoteParams,
  ): Promise<SparkReceiveQuoteCreated> {
    const { userEncryptionPublicKey, userId, account, lightningQuote } = params;
    const expiresAt = computeQuoteExpiry(params);
    const { amount, totalFee } = getAmountAndFee(params);

    const baseParams = {
      userId,
      accountId: account.id,
      amount,
      paymentRequest: lightningQuote.invoice.encodedInvoice,
      paymentHash: lightningQuote.invoice.paymentHash,
      description: lightningQuote.invoice.memo,
      expiresAt,
      sparkId: lightningQuote.id,
      receiverIdentityPubkey: lightningQuote.receiverIdentityPublicKey,
      totalFee,
    };

    if (params.receiveType === 'CASHU_TOKEN') {
      return this.repository.create({
        ...baseParams,
        userEncryptionPublicKey,
        receiveType: 'CASHU_TOKEN',
        meltData: {
          tokenMintUrl: params.sourceMintUrl,
          tokenAmount: params.tokenAmount,
          tokenProofs: params.tokenProofs,
          meltQuoteId: params.meltQuoteId,
          cashuReceiveFee: params.cashuReceiveFee,
          lightningFeeReserve: params.lightningFeeReserve,
        },
      });
    }

    return this.repository.create({
      ...baseParams,
      userEncryptionPublicKey,
      receiveType: 'LIGHTNING',
    });
  }
}
