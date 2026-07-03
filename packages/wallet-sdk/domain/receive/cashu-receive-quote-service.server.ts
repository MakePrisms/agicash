import { MintQuoteState } from '@cashu/cashu-ts';
import {
  type CreateQuoteBaseParams,
  computeQuoteExpiry,
  computeTotalFee,
} from './cashu-receive-quote-core';
import type {
  CashuReceiveQuoteCreated,
  CashuReceiveQuoteRepositoryServer,
} from './cashu-receive-quote-repository.server';

type CreateQuoteParams = CreateQuoteBaseParams & {
  /**
   * The user's encryption public key. Used to encrypt data on the server before storage.
   */
  userEncryptionPublicKey: string;
};

/**
 * Server-side service for Cashu receive quotes.
 * Limited to creating quotes only since the server cannot decrypt existing quotes.
 */
export class CashuReceiveQuoteServiceServer {
  constructor(
    private readonly cashuReceiveQuoteRepository: CashuReceiveQuoteRepositoryServer,
  ) {}

  /**
   * Creates a new cashu receive quote on the server.
   * @returns Minimal quote data without requiring decryption.
   */
  async createReceiveQuote(
    params: CreateQuoteParams,
  ): Promise<CashuReceiveQuoteCreated> {
    const {
      userId,
      account,
      lightningQuote,
      receiveType,
      userEncryptionPublicKey,
    } = params;

    if (lightningQuote.mintQuote.state !== MintQuoteState.UNPAID) {
      throw new Error('Mint quote must be unpaid');
    }

    const expiresAt = computeQuoteExpiry(params);
    const totalFee = computeTotalFee(params);

    const baseParams = {
      accountId: account.id,
      userId,
      amount: lightningQuote.amount,
      description: lightningQuote.description,
      quoteId: lightningQuote.mintQuote.quote,
      expiresAt,
      paymentRequest: lightningQuote.mintQuote.request,
      paymentHash: lightningQuote.paymentHash,
      lockingDerivationPath: lightningQuote.fullLockingDerivationPath,
      mintingFee: lightningQuote.mintingFee,
      totalFee,
      receiveType,
      userEncryptionPublicKey,
    };

    if (receiveType === 'CASHU_TOKEN') {
      return this.cashuReceiveQuoteRepository.create({
        ...baseParams,
        receiveType,
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

    return this.cashuReceiveQuoteRepository.create({
      ...baseParams,
      receiveType,
    });
  }
}
