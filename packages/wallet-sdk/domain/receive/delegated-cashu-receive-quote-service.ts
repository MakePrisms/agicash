import { MintQuoteState } from '@cashu/cashu-ts';
import {
  type CreateQuoteBaseParams,
  computeQuoteExpiry,
  computeTotalFee,
} from './cashu-receive-quote-core';
import type {
  CashuReceiveQuoteCreated,
  DelegatedCashuReceiveQuoteRepository,
} from './delegated-cashu-receive-quote-repository';

type CreateQuoteParams = CreateQuoteBaseParams & {
  /**
   * The recipient's encryption public key. The payload is encrypted to it before storage.
   */
  userEncryptionPublicKey: string;
};

/**
 * Delegated service for Cashu receive quotes — creates them on the recipient's behalf.
 * Limited to creating quotes only since the delegate cannot decrypt existing quotes.
 */
export class DelegatedCashuReceiveQuoteService {
  constructor(
    private readonly cashuReceiveQuoteRepository: DelegatedCashuReceiveQuoteRepository,
  ) {}

  /**
   * Creates a new cashu receive quote on the recipient's behalf.
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
