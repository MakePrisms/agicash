/**
 * Cashu lightning-send SERVICE — Slice 3 / PR5b. The idempotent service primitives for a
 * `CashuSendQuote`'s lifecycle.
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/send/cashu-send-quote-service.ts`. Master's `CashuSendQuoteService`
 * is ALREADY a plain class (only the `useCashuSendQuoteService()` factory couples it to React);
 * here it is lifted near-verbatim, dropping the factory and taking the SDK
 * {@link CashuSendQuoteRepository}. The mint operations (`createMeltQuoteBolt11` /
 * `meltProofsIdempotent` / `checkMeltQuoteBolt11`) run against the account's LIVE
 * `ExtendedCashuWallet` handle (PR5a). `initiateSend`'s `meltProofsIdempotent` is the
 * idempotency keystone — a re-issued melt with the same deterministic counter does not
 * double-spend.
 *
 * The state-machine that SEQUENCES these primitives (UNPAID → PENDING → PAID, driven off DB
 * state + the mint melt-quote WS subscription) is the `executeQuote` ORCHESTRATOR — deferred to
 * the orchestrator sub-slice (see `domains/cashu.ts`). These methods are the steps it calls.
 *
 * @module
 */
import {
  type MeltQuoteBolt11Response,
  MeltQuoteState,
  OutputData,
} from '@cashu/cashu-ts';
import type { Big } from 'big.js';
import { matchBlindSignaturesToOutputData } from '../../../../apps/web-wallet/app/lib/cashu/blind-signature-matching';
import { getDefaultUnit } from '../../../../apps/web-wallet/app/features/shared/currencies';
import type { CashuSendQuoteRepository } from './cashu-send-quote-repository';
import { getCashuUnit, sumProofs, toProof } from './lib-cashu-quotes';
import { decodeBolt11, parseBolt11Invoice } from './lib-scan';
import { DomainError } from '../errors';
import type { CashuAccount, CashuProof } from '../types/account';
import type { CashuSendQuote, DestinationDetails } from '../types/cashu';
import { type Currency, Money } from '../types/money';

/** Options for {@link CashuSendQuoteService.getLightningQuote} (master verbatim). */
export type GetCashuLightningQuoteOptions = {
  account: CashuAccount;
  paymentRequest: string;
  amount?: Money;
  exchangeRate?: Big;
};

/** The computed lightning quote returned before the send is persisted (master verbatim). */
export type CashuLightningQuote = {
  paymentRequest: string;
  amountRequested: Money;
  amountRequestedInBtc: Money<'BTC'>;
  meltQuote: MeltQuoteBolt11Response;
  amountToReceive: Money;
  lightningFeeReserve: Money;
  estimatedCashuFee: Money;
  estimatedTotalFee: Money;
  estimatedTotalAmount: Money;
  expiresAt: Date | null;
};

/** The minimal quote data {@link CashuSendQuoteService.createSendQuote} persists from. */
export type SendQuoteRequest = {
  paymentRequest: string;
  amountRequested: Money;
  amountRequestedInBtc: Money<'BTC'>;
  meltQuote: MeltQuoteBolt11Response;
};

/** Idempotent service primitives for a cashu lightning-send quote. */
export class CashuSendQuoteService {
  constructor(private readonly cashuSendRepository: CashuSendQuoteRepository) {}

  /**
   * Get a lightning quote: validate the invoice, create the mint melt quote, select proofs,
   * and compute the amounts/fees. Master verbatim.
   */
  async getLightningQuote({
    account,
    paymentRequest,
    amount,
    exchangeRate,
  }: GetCashuLightningQuoteOptions): Promise<CashuLightningQuote> {
    const bolt11ValidationResult = parseBolt11Invoice(paymentRequest);
    if (!bolt11ValidationResult.valid) {
      throw new DomainError('Invalid lightning invoice');
    }
    const invoice = bolt11ValidationResult.decoded;
    const expiresAt = invoice.expiryUnixMs
      ? new Date(invoice.expiryUnixMs)
      : null;

    if (expiresAt && expiresAt < new Date()) {
      throw new DomainError('Lightning invoice has expired');
    }

    let amountRequestedInBtc = new Money({ amount: 0, currency: 'BTC' });

    if (invoice.amountMsat) {
      amountRequestedInBtc = new Money({
        amount: invoice.amountMsat,
        currency: 'BTC',
        unit: 'msat',
      });
    } else if (amount) {
      if (amount.currency === 'BTC') {
        amountRequestedInBtc = amount as Money<'BTC'>;
      } else if (exchangeRate) {
        amountRequestedInBtc = amount.convert('BTC', exchangeRate);
      } else {
        throw new Error('Exchange rate is required for non-BTC amounts');
      }
    } else {
      throw new Error('Unknown send amount');
    }

    // TODO: remove this once cashu-ts supports amountless lightning invoices
    if (!invoice.amountMsat) {
      throw new Error(
        'Cashu accounts do not support amountless lightning invoices',
      );
    }

    const cashuUnit = getCashuUnit(account.currency);
    const wallet = account.wallet;

    const meltQuote = await wallet.createMeltQuoteBolt11(paymentRequest);
    const amountWithLightningFee = meltQuote.amount + meltQuote.fee_reserve;

    const { proofs, fee: proofsFee } = this.selectProofs(
      account,
      amountWithLightningFee,
    );

    const amountToReceive = new Money({
      amount: meltQuote.amount,
      currency: account.currency,
      unit: cashuUnit,
    });
    const lightningFeeReserve = new Money({
      amount: meltQuote.fee_reserve,
      currency: account.currency,
      unit: cashuUnit,
    });

    const unit = getDefaultUnit(account.currency);

    const sumOfSendProofs = sumProofs(proofs);
    if (sumOfSendProofs < amountWithLightningFee) {
      throw new DomainError(
        `Insufficient balance. Estimated total including fee is ${amountToReceive.add(lightningFeeReserve).toLocaleString({ unit })}.`,
      );
    }

    const estimatedCashuFee = new Money({
      amount: proofsFee,
      currency: account.currency,
      unit: cashuUnit,
    });
    const estimatedTotalFee = lightningFeeReserve.add(estimatedCashuFee);
    const estimatedTotalAmount = amountToReceive.add(estimatedTotalFee);

    return {
      paymentRequest,
      amountRequested: amount ?? (amountRequestedInBtc as Money<Currency>),
      amountRequestedInBtc,
      meltQuote,
      amountToReceive,
      lightningFeeReserve,
      estimatedCashuFee,
      estimatedTotalFee,
      estimatedTotalAmount,
      expiresAt,
    };
  }

  /** Create (persist) the send quote without initiating the send. Master verbatim. */
  async createSendQuote({
    userId,
    account,
    sendQuote,
    destinationDetails,
    purpose,
    transferId,
  }: {
    userId: string;
    account: CashuAccount;
    sendQuote: SendQuoteRequest;
    destinationDetails?: DestinationDetails;
    purpose?: string;
    transferId?: string;
  }): Promise<CashuSendQuote> {
    const meltQuote = sendQuote.meltQuote;
    const expiresAt = new Date(meltQuote.expiry * 1000);
    const now = new Date();

    if (now > expiresAt) {
      throw new DomainError('Quote has expired');
    }

    const cashuUnit = getCashuUnit(account.currency);
    const wallet = account.wallet;
    const keyset = wallet.getKeyset();
    const keysetId = keyset.id;

    const amountWithLightningFee = meltQuote.amount + meltQuote.fee_reserve;

    const { proofs, fee: proofsFee } = this.selectProofs(
      account,
      amountWithLightningFee,
    );
    const proofsToSendSum = sumProofs(proofs);
    const totalAmountToSend = amountWithLightningFee + proofsFee;

    const amountToReceive = new Money({
      amount: meltQuote.amount,
      currency: account.currency,
      unit: cashuUnit,
    });
    const lightningFeeReserve = new Money({
      amount: meltQuote.fee_reserve,
      currency: account.currency,
      unit: cashuUnit,
    });
    const cashuFee = new Money({
      amount: proofsFee,
      currency: account.currency,
      unit: cashuUnit,
    });
    const estimatedTotalFee = lightningFeeReserve.add(cashuFee);
    const unit = getDefaultUnit(account.currency);

    if (proofsToSendSum < totalAmountToSend) {
      throw new DomainError(
        `Insufficient balance. Estimated total including fee is ${amountToReceive.add(estimatedTotalFee).toLocaleString({ unit })}.`,
      );
    }

    const maxPotentialChangeAmount =
      proofsToSendSum - meltQuote.amount - proofsFee;
    const numberOfChangeOutputs =
      maxPotentialChangeAmount === 0
        ? 0
        : Math.ceil(Math.log2(maxPotentialChangeAmount)) || 1;

    const amountReserved = new Money({
      amount: proofsToSendSum,
      currency: account.currency,
      unit: cashuUnit,
    });

    const {
      decoded: { paymentHash },
    } = decodeBolt11(sendQuote.paymentRequest);

    return this.cashuSendRepository.create({
      userId,
      accountId: account.id,
      paymentRequest: sendQuote.paymentRequest,
      paymentHash,
      expiresAt: expiresAt.toISOString(),
      amountRequested: sendQuote.amountRequested,
      amountRequestedInMsat: sendQuote.amountRequestedInBtc.toNumber('msat'),
      amountToReceive,
      lightningFeeReserve,
      cashuFee,
      quoteId: meltQuote.quote,
      keysetId,
      numberOfChangeOutputs,
      proofsToSend: proofs,
      amountReserved,
      destinationDetails,
      purpose,
      transferId,
    });
  }

  /**
   * Initiate the send by calling the mint's melt-proofs endpoint (idempotent — deterministic
   * counter). Master verbatim.
   *
   * @throws Error if the account/quote don't match or the quote is not UNPAID.
   */
  async initiateSend(
    account: CashuAccount,
    sendQuote: CashuSendQuote,
    meltQuote: Pick<MeltQuoteBolt11Response, 'quote' | 'amount'>,
  ) {
    if (account.id !== sendQuote.accountId) {
      throw new Error('Account does not match');
    }
    if (sendQuote.quoteId !== meltQuote.quote) {
      throw new Error('Quote does not match');
    }
    if (sendQuote.state !== 'UNPAID') {
      throw new Error(`Send is not unpaid. Current state: ${sendQuote.state}`);
    }

    const wallet = account.wallet;

    return wallet.meltProofsIdempotent(
      meltQuote,
      sendQuote.proofs.map((p) => toProof(p)),
      { keysetId: sendQuote.keysetId },
      { type: 'deterministic', counter: sendQuote.keysetCounter },
    );
  }

  /**
   * Mark the send quote PENDING. No-op if already pending. Master verbatim.
   *
   * @throws Error if the quote is not UNPAID.
   */
  async markSendQuoteAsPending(quote: CashuSendQuote) {
    if (quote.state === 'PENDING') {
      return quote;
    }
    if (quote.state !== 'UNPAID') {
      throw new Error(
        `Only unpaid cashu send quote can be marked as pending. Current state: ${quote.state}`,
      );
    }
    return this.cashuSendRepository.markAsPending(quote.id);
  }

  /**
   * Complete the send quote after a successful payment, deriving + matching the NUT-08 change
   * proofs. No-op if already PAID. Master verbatim.
   *
   * @throws Error if the account/quote don't match, the state is wrong, or the melt is not paid.
   */
  async completeSendQuote(
    account: CashuAccount,
    sendQuote: CashuSendQuote,
    meltQuote: MeltQuoteBolt11Response,
  ) {
    if (sendQuote.state === 'PAID') {
      return sendQuote;
    }
    if (!['PENDING', 'UNPAID'].includes(sendQuote.state)) {
      throw new Error(
        `Cannot complete send quote that is not pending or unpaid. Current state: ${sendQuote.state}`,
      );
    }
    if (account.id !== sendQuote.accountId) {
      throw new Error('Account does not match the quote account');
    }
    if (meltQuote.quote !== sendQuote.quoteId) {
      throw new Error('Quote does not match');
    }
    if (meltQuote.state !== MeltQuoteState.PAID) {
      throw new Error(
        `Cannot complete send. Melt quote is not paid. Current state: ${meltQuote.state}`,
      );
    }
    if (!meltQuote.payment_preimage) {
      console.warn('Payment preimage is missing on the melt quote');
    }

    const cashuUnit = getCashuUnit(account.currency);
    const wallet = account.wallet;

    // Re-derive the deterministic NUT-08 change OutputData and match the mint's (possibly
    // unordered) change BlindSignatures via DLEQ (see cashu-ts issue 287). Master verbatim.
    await wallet.keyChain.ensureKeysetKeys(sendQuote.keysetId);
    const keyset = wallet.getKeyset(sendQuote.keysetId);
    const amounts = sendQuote.numberOfChangeOutputs
      ? Array(sendQuote.numberOfChangeOutputs).fill(1)
      : [];
    const outputData = OutputData.createDeterministicData(
      amounts.length,
      wallet.seed,
      sendQuote.keysetCounter,
      keyset,
      amounts,
    );
    const changeProofs = meltQuote.change?.length
      ? matchBlindSignaturesToOutputData(meltQuote.change, outputData, keyset)
      : [];

    const amountSpent = new Money({
      amount: sumProofs(sendQuote.proofs) - sumProofs(changeProofs),
      currency: account.currency,
      unit: cashuUnit,
    });

    return this.cashuSendRepository.complete({
      quote: sendQuote,
      paymentPreimage: meltQuote.payment_preimage ?? '',
      amountSpent,
      changeProofs,
    });
  }

  /**
   * Fail the send quote after a failed payment, re-checking the melt quote is UNPAID first
   * (so a pending/paid send is never failed). No-op if already FAILED. Master verbatim.
   *
   * @throws Error if the account/quote don't match, the state is wrong, or the melt is not unpaid.
   */
  async failSendQuote(
    account: CashuAccount,
    quote: CashuSendQuote,
    reason: string,
  ): Promise<CashuSendQuote> {
    if (quote.state === 'FAILED') {
      return quote;
    }
    if (!['PENDING', 'UNPAID'].includes(quote.state)) {
      throw new Error(
        `Cannot fail send quote that is not pending or unpaid. Current state: ${quote.state}`,
      );
    }
    if (account.id !== quote.accountId) {
      throw new Error('Account does not match the quote account');
    }

    const latestMeltQuote = await account.wallet.checkMeltQuoteBolt11(
      quote.quoteId,
    );
    if (latestMeltQuote.state !== MeltQuoteState.UNPAID) {
      // Pending/paid melt quotes must not be failed — the send is in progress or done. If the
      // mint fails the melt, it resets the melt quote to UNPAID again.
      throw new Error(
        `Cannot fail melt quote that is not unpaid. Current state for send quote ${quote.id}: ${latestMeltQuote.state}`,
      );
    }

    return this.cashuSendRepository.fail({ id: quote.id, reason });
  }

  /**
   * Expire the send quote (return the reserved proofs). No-op if already EXPIRED. Master verbatim.
   *
   * @throws Error if the quote is not UNPAID or has not expired yet.
   */
  async expireSendQuote(quote: CashuSendQuote): Promise<void> {
    if (quote.state === 'EXPIRED') {
      return;
    }
    if (quote.state !== 'UNPAID') {
      throw new Error('Cannot expire quote that is not unpaid');
    }
    if (new Date(quote.expiresAt) > new Date()) {
      throw new Error('Cannot expire quote that has not expired yet');
    }
    await this.cashuSendRepository.expire(quote.id);
  }

  /**
   * Select spendable proofs covering `amount` (+ their fee) from the account. Master verbatim.
   *
   * @returns the selected proofs + their cashu fee.
   */
  private selectProofs(
    account: CashuAccount,
    amount: number,
  ): { proofs: CashuProof[]; fee: number } {
    const accountProofsMap = new Map<string, CashuProof>(
      account.proofs.map((p) => [p.secret, p]),
    );

    const { send } = account.wallet.selectProofsToSend(
      account.proofs.map((p) => toProof(p)),
      amount,
      true,
    );

    const selectedProofs = send.map((p) => {
      const proof = accountProofsMap.get(p.secret);
      if (!proof) {
        throw new Error('Proof not found');
      }
      return proof;
    });

    return {
      proofs: selectedProofs,
      fee: account.wallet.getFeesForProofs(send),
    };
  }
}
