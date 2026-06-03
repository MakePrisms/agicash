/**
 * Cashu lightning-RECEIVE SERVICE — Slice 3 / PR5b. The idempotent primitives for a
 * `CashuReceiveQuote`'s lifecycle.
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/receive/cashu-receive-quote-service.ts`. Master's
 * `CashuReceiveQuoteService` is a plain class (only the `useCashuReceiveQuoteService()` factory
 * couples it to React); lifted near-verbatim, taking the SDK {@link CashuReceiveQuoteRepository}
 * + a {@link CashuCryptography} (the xPub / private-key the NUT-20 quote-locking needs, backed
 * by the OpenSecret client — re-housed off master's `useCashuCryptography` query options).
 *
 * `mintProofs`'s `wallet.restore` recovery (on OUTPUT_ALREADY_SIGNED / QUOTE_ALREADY_ISSUED) is
 * the re-mint / idempotency protection — preserved verbatim. The completion path
 * (`completeReceive` / `processPayment` → mint proofs) is what the (future) `executeQuote`
 * orchestrator drives; `createLightningQuote` (`getLightningQuote` + `createReceiveQuote`) is the
 * user-invoked kickoff.
 *
 * @module
 */
import {
  MintOperationError,
  MintQuoteState,
  OutputData,
  type Proof,
  splitAmount,
} from '@cashu/cashu-ts';
import { CashuErrorCodes } from './cashu-error-codes';
import type { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';
import {
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  derivePublicKey,
} from './lib-cashu-crypto';
import {
  type CashuReceiveLightningQuote,
  type CreateQuoteBaseParams,
  type GetLightningQuoteParams,
  computeQuoteExpiry,
  computeTotalFee,
  getLightningQuote,
} from './cashu-receive-quote-core';
import { getCashuUnit } from './lib-cashu';
import type { ExtendedCashuWallet } from './lib-cashu-wallet';
import type { CashuAccount } from '../types/account';
import type { CashuReceiveQuote } from '../types/cashu';

/**
 * The cashu key operations the receive flow needs (xPub for NUT-20 quote-locking, private key
 * for unlocking when minting). Re-housed off master's `shared/cashu.ts#CashuCryptography`
 * (React-coupled query options) — the SDK backs it with the OpenSecret client.
 */
export type CashuCryptography = {
  /** The cashu locking xPub at the given derivation path. */
  getXpub: (derivationPath?: string) => Promise<string>;
  /** The hex-encoded cashu locking private key at the given derivation path. */
  getPrivateKey: (derivationPath?: string) => Promise<string>;
};

/** Idempotent service primitives for a cashu lightning-receive quote. */
export class CashuReceiveQuoteService {
  constructor(
    private readonly cryptography: CashuCryptography,
    private readonly cashuReceiveQuoteRepository: CashuReceiveQuoteRepository,
  ) {}

  /**
   * Get a NUT-20-locked mint quote (the locked invoice to receive over). Master verbatim.
   *
   * @returns the mint quote + the data needed to persist a receive quote.
   */
  async getLightningQuote(
    params: Omit<GetLightningQuoteParams, 'xPub'>,
  ): Promise<CashuReceiveLightningQuote> {
    const xPub = await this.cryptography.getXpub(
      BASE_CASHU_LOCKING_DERIVATION_PATH,
    );
    return getLightningQuote({ ...params, xPub });
  }

  /**
   * Create (persist) a receive quote from a lightning quote. Master verbatim.
   *
   * @throws Error if the mint quote is not UNPAID.
   */
  async createReceiveQuote(
    params: CreateQuoteBaseParams,
  ): Promise<CashuReceiveQuote> {
    const {
      userId,
      account,
      lightningQuote,
      receiveType,
      purpose,
      transferId,
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
      purpose,
      transferId,
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
   * Mark the melt initiated for a CASHU_TOKEN receive. No-op if already initiated. Master verbatim.
   *
   * @throws Error if the quote is not CASHU_TOKEN or is not UNPAID.
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
   * Expire the receive quote. No-op if already EXPIRED. Master verbatim.
   *
   * @throws Error if the quote is not UNPAID or has not expired yet.
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
   * Fail the receive quote. No-op if already FAILED. Master verbatim.
   *
   * @throws Error if the quote is not UNPAID.
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
   * Complete the receive: prepare output data, mint proofs, persist + credit the account.
   * No-op if already COMPLETED. Master verbatim.
   *
   * @returns the updated quote, account, and added proof ids.
   * @throws Error if the quote belongs to another account or is expired/failed.
   */
  async completeReceive(
    account: CashuAccount,
    quote: CashuReceiveQuote,
  ): Promise<{
    quote: CashuReceiveQuote;
    account: CashuAccount;
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
      return this.processUnpaidQuote(wallet, quote);
    }
    return this.processPaidQuote(wallet, quote);
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
    const keyset = wallet.getKeyset(keysetId);
    const cashuUnit = getCashuUnit(quote.amount.currency);
    const amountInCashuUnit = quote.amount.toNumber(cashuUnit);
    const outputAmounts = splitAmount(amountInCashuUnit, keyset.keys);

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
    await wallet.keyChain.ensureKeysetKeys(quote.keysetId);
    const keyset = wallet.getKeyset(quote.keysetId);

    const outputData = OutputData.createDeterministicData(
      quote.amount.toNumber(cashuUnit),
      wallet.seed,
      quote.keysetCounter,
      keyset,
      quote.outputAmounts,
    );

    const mintedProofs = await this.mintProofs(wallet, quote, outputData);

    return this.cashuReceiveQuoteRepository.completeReceive({
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

      const xPub = await this.cryptography.getXpub(
        BASE_CASHU_LOCKING_DERIVATION_PATH,
      );
      const segments = quote.lockingDerivationPath.split('/');
      const unhardenedIndex = segments[segments.length - 1];
      const lockingPublicKey = derivePublicKey(xPub, `m/${unhardenedIndex}`);

      return await wallet.ops
        .mintBolt11(amount, {
          quote: quote.quoteId,
          request: quote.paymentRequest,
          state: MintQuoteState.PAID,
          expiry: Math.floor(new Date(quote.expiresAt).getTime() / 1000),
          pubkey: lockingPublicKey,
          amount,
          unit: wallet.unit,
        })
        .keyset(quote.keysetId)
        .privkey(unlockingKey)
        .asCustom(outputData)
        .run();
    } catch (error) {
      if (
        error instanceof MintOperationError &&
        ([
          CashuErrorCodes.OUTPUT_ALREADY_SIGNED,
          CashuErrorCodes.QUOTE_ALREADY_ISSUED,
        ].includes(error.code) ||
          error.message
            .toLowerCase()
            .includes('outputs have already been signed before') ||
          error.message.toLowerCase().includes('mint quote already issued.'))
      ) {
        const { proofs } = await wallet.restore(
          quote.keysetCounter,
          quote.outputAmounts.length,
          { keysetId: quote.keysetId },
        );
        return proofs;
      }
      throw error;
    }
  }
}
