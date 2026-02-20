import {
  MintOperationError,
  MintQuoteState,
  OutputData,
  type Proof,
} from '@cashu/cashu-ts';
import {
  CashuErrorCodes,
  type ExtendedCashuWallet,
  getCashuUnit,
  getOutputAmounts,
} from '../../lib/cashu';
import type { CashuAccount } from '../accounts/account';
import {
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  type CashuCryptography,
} from '../shared/cashu';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import {
  type CashuReceiveLightningQuote,
  type CreateQuoteBaseParams,
  type GetLightningQuoteParams,
  computeQuoteExpiry,
  computeTotalFee,
  getLightningQuote,
} from './cashu-receive-quote-core';
import type { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';

type CreateQuoteParams = CreateQuoteBaseParams;

export class CashuReceiveQuoteService {
  constructor(
    private readonly cryptography: CashuCryptography,
    private readonly cashuReceiveQuoteRepository: CashuReceiveQuoteRepository,
  ) {}

  /**
   * Gets a locked mint quote response for receiving lightning payments.
   * @returns The mint quote response and related data needed to create a receive quote.
   */
  async getLightningQuote(
    params: Omit<GetLightningQuoteParams, 'xPub'>,
  ): Promise<CashuReceiveLightningQuote> {
    const xPub = await this.cryptography.getXpub(
      BASE_CASHU_LOCKING_DERIVATION_PATH,
    );

    return getLightningQuote({
      ...params,
      xPub,
    });
  }

  /**
   * Creates a new cashu receive quote used for receiving via a bolt11 payment request.
   * @returns The created cashu receive quote with the bolt11 invoice to pay.
   */
  async createReceiveQuote(
    params: CreateQuoteParams,
  ): Promise<CashuReceiveQuote> {
    const { userId, account, lightningQuote, receiveType } = params;

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

  /**
   * Marks the melt as initiated for a CASHU_TOKEN type cashu receive quote.
   * It's a no-op if the melt was already marked as initiated.
   * @param quote - The cashu receive quote of type CASHU_TOKEN.
   * @returns The updated quote.
   * @throws An error if the quote is not of type CASHU_TOKEN or is not in UNPAID state.
   */
  async markMeltInitiated(
    quote: CashuReceiveQuote & { type: 'CASHU_TOKEN' },
  ): Promise<CashuReceiveQuote & { type: 'CASHU_TOKEN' }> {
    if (quote.type !== 'CASHU_TOKEN') {
      throw new Error('Invalid quote type. Quote must be of type CASHU_TOKEN.');
    }

    if (quote.tokenReceiveData.meltInitiated) {
      return quote;
    }

    if (quote.state !== 'UNPAID') {
      throw new Error(
        `Invalid quote state. Quote must be in UNPAID state. State: ${quote.state}`,
      );
    }

    return this.cashuReceiveQuoteRepository.markMeltInitiated(quote);
  }

  /**
   * Expires the cashu receive quote by setting the state to EXPIRED.
   * It's a no-op if the receive quote is already expired.
   * @param quote - The cashu receive quote to expire.
   * @throws An error if the receive quote is not unpaid or has not expired yet.
   */
  async expire(quote: CashuReceiveQuote): Promise<void> {
    if (quote.state === 'EXPIRED') {
      return;
    }

    if (quote.state !== 'UNPAID') {
      throw new Error('Cannot expire quote that is not unpaid');
    }

    if (new Date(quote.expiresAt) > new Date()) {
      throw new Error('Cannot expire quote that has not expired yet');
    }

    await this.cashuReceiveQuoteRepository.expire(quote.id);
  }

  /**
   * Fail the cashu receive quote by setting the state to FAILED.
   * It's a no-op if the receive quote is already failed.
   * @param quote - The cashu receive quote to fail.
   * @param reason - The reason for the failure.
   * @throws An error if the receive quote is not unpaid.
   */
  async fail(quote: CashuReceiveQuote, reason: string): Promise<void> {
    if (quote.state === 'FAILED') {
      return;
    }

    if (quote.state !== 'UNPAID') {
      throw new Error('Cannot fail quote that is not unpaid');
    }

    await this.cashuReceiveQuoteRepository.fail({ id: quote.id, reason });
  }

  /**
   * Completes the receive quote by preparing the output data, minting the proofs, updating the quote state and account proofs.
   * If the quote is already completed, it's a no-op that returns back passed quote, account and an empty array of added proof ids.
   * @param account - The cashu account that the quote belongs to.
   * @param quote - The cashu receive quote to complete.
   * @returns The updated quote, account and a list of added proof ids.
   * @throws An error if quote is expired or failed or if completing the quote fails.
   */
  async completeReceive(
    account: CashuAccount,
    quote: CashuReceiveQuote,
  ): Promise<{
    /**
     * The updated quote.
     */
    quote: CashuReceiveQuote;
    /**
     * The updated account with all the proofs including newly added ones.
     */
    account: CashuAccount;
    /**
     * A list of added proof ids.
     * Use if you need to know which proofs from the account proofs list are newly added.
     */
    addedProofs: string[];
  }> {
    if (quote.accountId !== account.id) {
      throw new Error('Quote does not belong to account');
    }

    if (quote.state === 'EXPIRED' || quote.state === 'FAILED') {
      throw new Error(
        `Cannot complete quote that is expired or failed. State: ${quote.state}`,
      );
    }

    if (quote.state === 'COMPLETED') {
      return { quote, account, addedProofs: [] };
    }

    const wallet = account.wallet;

    if (quote.state === 'UNPAID') {
      return await this.processUnpaidQuote(wallet, quote);
    }

    return await this.processPaidQuote(wallet, quote);
  }

  private async processUnpaidQuote(
    wallet: ExtendedCashuWallet,
    quote: CashuReceiveQuote,
  ): Promise<{
    quote: CashuReceiveQuote;
    account: CashuAccount;
    addedProofs: string[];
  }> {
    const keysetId = wallet.keysetId;
    const keys = await wallet.getKeys(keysetId);
    const cashuUnit = getCashuUnit(quote.amount.currency);
    const amountInCashuUnit = quote.amount.toNumber(cashuUnit);
    const outputAmounts = getOutputAmounts(amountInCashuUnit, keys);

    const result = await this.cashuReceiveQuoteRepository.processPayment({
      quote,
      keysetId,
      outputAmounts,
    });

    return this.processPaidQuote(wallet, result.quote);
  }

  private async processPaidQuote(
    wallet: ExtendedCashuWallet,
    quote: CashuReceiveQuote,
  ): Promise<{
    quote: CashuReceiveQuote;
    account: CashuAccount;
    addedProofs: string[];
  }> {
    if (quote.state !== 'PAID') {
      throw new Error('Quote must be in PAID state');
    }

    const cashuUnit = getCashuUnit(quote.amount.currency);
    const keys = await wallet.getKeys(quote.keysetId);

    const outputData = OutputData.createDeterministicData(
      quote.amount.toNumber(cashuUnit),
      wallet.seed,
      quote.keysetCounter,
      keys,
      quote.outputAmounts,
    );

    const mintedProofs = await this.mintProofs(wallet, quote, outputData);

    return await this.cashuReceiveQuoteRepository.completeReceive({
      quoteId: quote.id,
      proofs: mintedProofs,
    });
  }

  private async mintProofs(
    wallet: ExtendedCashuWallet,
    quote: CashuReceiveQuote,
    outputData: OutputData[],
  ): Promise<Proof[]> {
    if (quote.state !== 'PAID') {
      throw new Error(
        'Invalid quote state. Quote must be in PAID state to mint proofs.',
      );
    }

    try {
      const cashuUnit = getCashuUnit(quote.amount.currency);
      const amount = quote.amount.toNumber(cashuUnit);

      const unlockingKey = await this.cryptography.getPrivateKey(
        quote.lockingDerivationPath,
      );

      const proofs = await wallet.mintProofs(
        amount,
        // NOTE: cashu-ts makes us pass the mint quote response instead of just the quote id
        // if we want to use the private key to create a signature. However, the implementation
        // only ends up using the quote id.
        {
          quote: quote.quoteId,
          request: quote.paymentRequest,
          state: MintQuoteState.PAID,
          expiry: Math.floor(new Date(quote.expiresAt).getTime() / 1000),
          amount,
          unit: wallet.unit,
        },
        {
          keysetId: quote.keysetId,
          outputData,
          privateKey: unlockingKey,
        },
      );

      return proofs;
    } catch (error) {
      if (
        error instanceof MintOperationError &&
        ([
          CashuErrorCodes.OUTPUT_ALREADY_SIGNED,
          CashuErrorCodes.QUOTE_ALREADY_ISSUED,
        ].includes(error.code) ||
          // Nutshell mint implementation did not conform to the spec up until version 0.16.5 (see https://github.com/cashubtc/nutshell/pull/693)
          // so for earlier versions we need to check the message.
          error.message
            .toLowerCase()
            .includes('outputs have already been signed before') ||
          error.message.toLowerCase().includes('mint quote already issued.'))
      ) {
        const { proofs } = await wallet.restore(
          quote.keysetCounter,
          quote.outputAmounts.length,
          {
            keysetId: quote.keysetId,
          },
        );
        return proofs;
      }
      throw error;
    }
  }
}
