import { MintQuoteState } from '@cashu/cashu-ts';
import {
  type CreateQuoteBaseParams,
  computeQuoteExpiry,
  computeTotalFee,
} from './cashu-receive-quote-core';
import { DomainError } from '../../errors';
import type {
  CashuReceiveQuoteCreated,
  CashuReceiveQuoteRepositoryServer,
} from '../../internal/repositories/cashu-receive-quote-repository.server';

type CreateQuoteParams = CreateQuoteBaseParams & {
  userEncryptionPublicKey: string;
};

/** Server-side cashu receive-quote service: create-only (no read/decrypt). */
export class CashuReceiveQuoteServiceServer {
  constructor(
    private readonly cashuReceiveQuoteRepository: CashuReceiveQuoteRepositoryServer,
  ) {}

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
      throw new DomainError('Mint quote must be unpaid', 'invalid_state');
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
