import {
  type MeltQuoteResponse,
  MeltQuoteState,
  OutputData,
} from '@cashu/cashu-ts';
import type { Big } from 'big.js';
import { parseBolt11Invoice } from '~/lib/bolt11';
import { getCashuUnit, sumProofs } from '~/lib/cashu';
import { type Currency, Money } from '~/lib/money';
import type { CashuAccount } from '../accounts/account';
import { getDefaultUnit } from '../shared/currencies';
import { DomainError } from '../shared/error';
import type { DestinationDetails } from '../transactions/transaction';
import type { CashuSendQuote } from './cashu-send-quote';
import {
  type CashuSendQuoteRepository,
  useCashuSendQuoteRepository,
} from './cashu-send-quote-repository';

export type GetCashuLightningQuoteOptions = {
  /**
   * The account to send the money from.
   */
  account: CashuAccount;
  /**
   * Bolt 11 lightning invoice to pay.
   */
  paymentRequest: string;
  /**
   * The amount to send. Needs to be provided in case of amountless lightning invoice.
   * If the invoice has an amount and this is provided, it will be ignored.
   */
  amount?: Money;
  /**
   * The exchange rate to be used to convert the amount to milli-satoshis.
   * Must be provided if amount is provided in any currency other than BTC. Otherwise the exception will be thrown.
   */
  exchangeRate?: Big;
};

export type CashuLightningQuote = {
  /**
   * The payment request to pay.
   */
  paymentRequest: string;
  /**
   * The amount requested.
   */
  amountRequested: Money;
  /**
   * The amount requested in BTC.
   */
  amountRequestedInBtc: Money<'BTC'>;
  /**
   * The mint's melt quote.
   */
  meltQuote: MeltQuoteResponse;
  /**
   * The amount that the receiver will receive.
   */
  amountToReceive: Money;
  /**
   * The maximum lightning network fee that will be charged for the send.
   * If the amount reserved is bigger than the actual fee, the difference will be returned to the senderas change.
   */
  lightningFeeReserve: Money;
  /**
   * Estimated cashu mint fee that will be charged for the proofs melted.
   * Actual fee might be different if the proofs selected at the time when the send is confirmed are different from the ones used to create the quote.
   */
  estimatedCashuFee: Money;
  /**
   * Estimated total fee (lightning fee reserve + estimated cashu fee).
   */
  estimatedTotalFee: Money;
  /**
   * Estimated total amount of the send (amount to receive + lightning fee reserve + estimated cashu fee).
   */
  estimatedTotalAmount: Money;
};

export type SendQuoteRequest = {
  paymentRequest: string;
  amountRequested: Money;
  amountRequestedInBtc: Money<'BTC'>;
  meltQuote: MeltQuoteResponse;
};

export class CashuSendQuoteService {
  constructor(private readonly cashuSendRepository: CashuSendQuoteRepository) {}

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

    if (invoice.expiryUnixMs && new Date(invoice.expiryUnixMs) < new Date()) {
      throw new DomainError('Lightning invoice has expired');
    }

    let amountRequestedInBtc = new Money({
      amount: 0,
      currency: 'BTC',
    });

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

    // TODO: remove this once we cashu-ts supports amountless lightning invoices
    if (!invoice.amountMsat) {
      throw new Error(
        "Cashu ts lib doesn't support amountless lightning invoices yet",
      );
    }

    const cashuUnit = getCashuUnit(account.currency);
    const wallet = account.wallet;
    await wallet.getKeys();

    const meltQuote = await wallet.createMeltQuote(paymentRequest);

    const amountWithLightningFee = meltQuote.amount + meltQuote.fee_reserve;

    const proofs = wallet.selectProofsToSend(
      account.proofs,
      amountWithLightningFee,
      true,
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

    const sumOfSendProofs = sumProofs(proofs.send);
    if (sumOfSendProofs < amountWithLightningFee) {
      throw new DomainError(
        `Insufficient balance. Estimated total including fee is ${amountToReceive.add(lightningFeeReserve).toLocaleString({ unit })}.`,
      );
    }

    const proofsFee = wallet.getFeesForProofs(proofs.send);
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
    };
  }

  /**
   * Creates the send quote but does not initiate the send.
   */
  async createSendQuote({
    userId,
    account,
    sendQuote,
    destinationDetails,
  }: {
    /**
     * ID of the sender.
     */
    userId: string;
    /**
     * The account to send the money from.
     */
    account: CashuAccount;
    /**
     * The send quote to create.
     */
    sendQuote: SendQuoteRequest;
    /**
     * The destination details of the send, like the contact ID or lightning address used to fetch the payment request.
     * This will be undefined if the send is directly paying a bolt11.
     */
    destinationDetails?: DestinationDetails;
  }) {
    const meltQuote = sendQuote.meltQuote;
    const expiresAt = new Date(meltQuote.expiry * 1000);
    const now = new Date();

    if (now > expiresAt) {
      throw new DomainError('Quote has expired');
    }

    const cashuUnit = getCashuUnit(account.currency);
    const wallet = account.wallet;
    const keys = await wallet.getKeys();
    const keysetId = keys.id;

    const amountWithLightningFee = meltQuote.amount + meltQuote.fee_reserve;

    const proofs = wallet.selectProofsToSend(
      account.proofs,
      amountWithLightningFee,
      true,
    );
    const proofsToSendSum = sumProofs(proofs.send);

    const proofsFee = wallet.getFeesForProofs(proofs.send);
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
    const keysetCounter = account.keysetCounters[keysetId] ?? 0;

    return this.cashuSendRepository.create({
      userId: userId,
      accountId: account.id,
      paymentRequest: sendQuote.paymentRequest,
      expiresAt: expiresAt.toISOString(),
      amountRequested: sendQuote.amountRequested,
      amountRequestedInMsat: sendQuote.amountRequestedInBtc.toNumber('msat'),
      amountToReceive,
      lightningFeeReserve,
      cashuFee,
      quoteId: meltQuote.quote,
      keysetId,
      keysetCounter,
      numberOfChangeOutputs,
      proofsToSend: proofs.send,
      accountVersion: account.version,
      proofsToKeep: proofs.keep,
      destinationDetails,
    });
  }

  /**
   * Initiates the send for the quote.
   */
  async initiateSend(
    account: CashuAccount,
    sendQuote: CashuSendQuote,
    meltQuote: MeltQuoteResponse,
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

    return wallet
      .meltProofs(meltQuote, sendQuote.proofs, {
        keysetId: sendQuote.keysetId,
        counter: sendQuote.keysetCounter,
      })
      .catch(async (error) => {
        // Initiate send should be idempotent: if meltProofs was already called once and did not fail,
        // then the melt quote will be pending or paid.
        const latestMeltQuote = await wallet.checkMeltQuote(sendQuote.quoteId);
        if (latestMeltQuote.state !== MeltQuoteState.UNPAID) {
          console.warn(
            'Initiate send was called but melt quote is not unpaid',
            {
              sendQuote,
              latestMeltQuote,
            },
          );
          return latestMeltQuote;
        }
        throw error;
      });
  }

  /**
   * Marks the send quote as pending. This indicates that the send is in progress.
   */
  async markSendQuoteAsPending(quote: CashuSendQuote) {
    if (quote.state !== 'UNPAID') {
      throw new Error(
        `Only unpaid cashu send quote can be marked as pending. Current state: ${quote.state}`,
      );
    }

    return this.cashuSendRepository.markAsPending({
      id: quote.id,
      version: quote.version,
    });
  }

  /**
   * Completes the send quote after successful payment.
   */
  async completeSendQuote(
    account: CashuAccount,
    sendQuote: CashuSendQuote,
    meltQuote: MeltQuoteResponse,
  ) {
    if (sendQuote.state !== 'PENDING') {
      throw new Error(
        `Cannot complete send quote that is not pending. Current state: ${sendQuote.state}`,
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

    // We are creating output data here in the same way that cashu-ts does in the meltProofs function.
    // This is needed because we need the deterministic output data to be able to convert the change signatures to proofs.
    // See https://github.com/cashubtc/cashu-ts/issues/287 for more details. If cashu-ts eventually exposes the way to create
    // blank outputs we will be able to simplify this.
    const keys = await wallet.getKeys(sendQuote.keysetId);
    const amounts = sendQuote.numberOfChangeOutputs
      ? Array(sendQuote.numberOfChangeOutputs).fill(1)
      : [];
    const outputData = OutputData.createDeterministicData(
      amounts.length,
      wallet.seed,
      sendQuote.keysetCounter,
      keys,
      amounts,
    );
    const changeProofs =
      meltQuote.change?.map((s, i) => outputData[i].toProof(s, keys)) ?? [];

    const updatedAccountProofs = [...account.proofs, ...changeProofs];

    const amountSpent = new Money({
      amount: sumProofs(sendQuote.proofs) - sumProofs(changeProofs),
      currency: account.currency,
      unit: cashuUnit,
    });

    return this.cashuSendRepository.complete({
      quote: sendQuote,
      paymentPreimage: meltQuote.payment_preimage ?? '',
      amountSpent,
      accountProofs: updatedAccountProofs,
      accountVersion: account.version,
    });
  }

  /**
   * Failes the send quote after failed payment.
   */
  async failSendQuote(
    account: CashuAccount,
    quote: CashuSendQuote,
    reason: string,
  ) {
    if (!['PENDING', 'UNPAID'].includes(quote.state)) {
      throw new Error(
        `Cannot fail send quote that is not pending or unpaid. Current state: ${quote.state}`,
      );
    }

    if (account.id !== quote.accountId) {
      throw new Error('Account does not match the quote account');
    }

    const latestMeltQuote = await account.wallet.checkMeltQuote(quote.quoteId);
    if (latestMeltQuote.state !== MeltQuoteState.UNPAID) {
      // Pending and paid melt quotes should not be failed because that means the send is in progress or has already been completed.
      // If the mint fails to pay the melt quote, then the melt quote state will be changed to UNPAID again.
      throw new Error(
        `Cannot fail melt quote that is not unpaid. Current state for send quote ${quote.id}: ${latestMeltQuote.state}`,
      );
    }

    const updatedAccountProofs = account.proofs.concat(quote.proofs);

    await this.cashuSendRepository.fail({
      id: quote.id,
      reason,
      version: quote.version,
      accountProofs: updatedAccountProofs,
      accountVersion: account.version,
    });
  }

  /**
   * Expires the cashu send quote by setting the state to EXPIRED.
   * It also updates the account proofs to return the unspent proofs that were reserved for the send.
   */
  async expireSendQuote(
    account: CashuAccount,
    quote: CashuSendQuote,
  ): Promise<void> {
    if (quote.state === 'EXPIRED') {
      return;
    }

    if (quote.state !== 'UNPAID') {
      throw new Error('Cannot expire quote that is not unpaid');
    }

    if (new Date(quote.expiresAt) > new Date()) {
      throw new Error('Cannot expire quote that has not expired yet');
    }

    if (account.id !== quote.accountId) {
      throw new Error('Account does not match the quote account');
    }

    const updatedAccountProofs = account.proofs.concat(quote.proofs);

    await this.cashuSendRepository.expire({
      id: quote.id,
      version: quote.version,
      accountProofs: updatedAccountProofs,
      accountVersion: account.version,
    });
  }
}

export function useCashuSendQuoteService() {
  const cashuSendQuoteRepository = useCashuSendQuoteRepository();
  return new CashuSendQuoteService(cashuSendQuoteRepository);
}
