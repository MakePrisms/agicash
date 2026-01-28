import {
  type MeltQuoteResponse,
  MeltQuoteState,
  OutputData,
  type PartialMeltQuoteResponse,
} from '@cashu/cashu-ts';
import type { Big } from 'big.js';
import { decodeBolt11, parseBolt11Invoice } from '~/lib/bolt11';
import { getCashuUnit, sumProofs } from '~/lib/cashu';
import { type Currency, Money } from '~/lib/money';
import type { CashuAccount } from '../accounts/account';
import { type CashuProof, toProof } from '../accounts/cashu-account';
import { DomainError } from '../shared/error';
import type { CashuSendQuote, DestinationDetails } from './cashu-send-quote';
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
  /**
   * The expiry date of the lightning invoice.
   */
  expiresAt: Date | null;
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
    const expiresAt = invoice.expiryUnixMs
      ? new Date(invoice.expiryUnixMs)
      : null;

    if (expiresAt && expiresAt < new Date()) {
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

    // TODO: remove this once cashu-ts supports amountless lightning invoices
    if (!invoice.amountMsat) {
      throw new Error(
        'Cashu accounts do not support amountless lightning invoices',
      );
    }

    const cashuUnit = getCashuUnit(account.currency);
    const wallet = account.wallet;
    await wallet.getKeys();

    const meltQuote = await wallet.createMeltQuote(paymentRequest);

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

    const sumOfSendProofs = sumProofs(proofs);
    if (sumOfSendProofs < amountWithLightningFee) {
      throw new DomainError(
        `Insufficient balance. Estimated total including fee is ${amountToReceive.add(lightningFeeReserve).toLocaleString()}.`,
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

    if (proofsToSendSum < totalAmountToSend) {
      throw new DomainError(
        `Insufficient balance. Estimated total including fee is ${amountToReceive.add(estimatedTotalFee).toLocaleString()}.`,
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

    const { paymentHash } = decodeBolt11(sendQuote.paymentRequest);

    return this.cashuSendRepository.create({
      userId: userId,
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
    });
  }

  /**
   * Initiates the send for the quote by calling the mint's melt proofs endpoint.
   * @throws An error if the account does not match the send quote account or the quote does not match the melt quote or the send quote is not unpaid.
   * @returns Melt proofs response from the mint.
   */
  async initiateSend(
    account: CashuAccount,
    sendQuote: CashuSendQuote,
    meltQuote: Pick<MeltQuoteResponse, 'quote' | 'amount'>,
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
      {
        keysetId: sendQuote.keysetId,
        counter: sendQuote.keysetCounter,
      },
    );
  }

  /**
   * Marks the send quote as pending. This indicates that the send is in progress.
   * If the send quote is already pending, it's a no-op that returns back passed quote.
   * @throws An error if the send quote is not unpaid.
   * @returns The updated send quote.
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
   * Completes the send quote after successful payment.
   * If the send quote is already paid, it's a no-op that returns back passed quote.
   * @throws An error if the account does not match the send quote account or the quote does not match the melt quote or the send quote is not pending.
   * @returns The updated send quote.
   */
  async completeSendQuote(
    account: CashuAccount,
    sendQuote: CashuSendQuote,
    meltQuote: PartialMeltQuoteResponse,
  ) {
    if (sendQuote.state === 'PAID') {
      return sendQuote;
    }

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
   * Failes the send quote after failed payment.
   * If the send quote is already failed, it's a no-op that returns back passed quote.
   * @returns The updated send quote.
   * @throws An error if the account does not match the send quote account or the quote is not pending or unpaid.
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

    const latestMeltQuote = await account.wallet.checkMeltQuote(quote.quoteId);
    if (latestMeltQuote.state !== MeltQuoteState.UNPAID) {
      // Pending and paid melt quotes should not be failed because that means the send is in progress or has already been completed.
      // If the mint fails to pay the melt quote, then the melt quote state will be changed to UNPAID again.
      throw new Error(
        `Cannot fail melt quote that is not unpaid. Current state for send quote ${quote.id}: ${latestMeltQuote.state}`,
      );
    }

    return await this.cashuSendRepository.fail({
      id: quote.id,
      reason,
    });
  }

  /**
   * Expires the cashu send quote by setting the state to EXPIRED.
   * It also updates the account proofs to return the unspent proofs that were reserved for the send.
   * It's a no-op if the send quote is already expired.
   * @throws An error if the send quote is not unpaid or has not expired yet.
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
   * Selects spendable proofs from the account for the provided amount.
   * Sum of the selected proofs is equal or greater than the provided amount. If there are not enough proofs, an empty array is returned.
   * Fee for the selected proofs plus the provided amount can be greater than the sum of the selected proofs. If this is the case, the account doesn't have enough balance for the send.
   * @param account - The account to select proofs from.
   * @param amount - The amount to select proofs for.
   * @returns Selected proofs for the provided amount and the fee for the selected proofs.
   */
  private selectProofs(
    account: CashuAccount,
    amount: number,
  ): {
    /**
     * Selected proofs for the provided amount.
     * Total amount of the proofs is equal or greater than the provided amount.
     */
    proofs: CashuProof[];
    /**
     * Fee for the selected proofs.
     */
    fee: number;
  } {
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

export function useCashuSendQuoteService() {
  const cashuSendQuoteRepository = useCashuSendQuoteRepository();
  return new CashuSendQuoteService(cashuSendQuoteRepository);
}
