import type {
  SparkReceiveQuoteCreated,
  SparkReceiveQuoteRepositoryServer,
} from '../../internal/repositories/spark-receive-quote-repository.server';
import {
  type CreateQuoteBaseParams,
  type GetLightningQuoteParams,
  type SparkReceiveLightningQuote,
  computeQuoteExpiry,
  getAmountAndFee,
  getLightningQuote,
} from './spark-receive-quote-core';

type CreateQuoteParams = CreateQuoteBaseParams & {
  userEncryptionPublicKey: string;
};

/** Server-side spark receive-quote service: get a lightning quote + create (no read/decrypt). */
export class SparkReceiveQuoteServiceServer {
  constructor(private readonly repository: SparkReceiveQuoteRepositoryServer) {}

  getLightningQuote(
    params: GetLightningQuoteParams,
  ): Promise<SparkReceiveLightningQuote> {
    return getLightningQuote(params);
  }

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
      paymentRequest: lightningQuote.invoice.paymentRequest,
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
