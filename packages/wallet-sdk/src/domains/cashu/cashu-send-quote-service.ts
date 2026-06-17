import { type Currency, Money } from '@agicash/money';
import {
  type MeltQuoteBolt11Response,
  MeltQuoteState,
  OutputData,
} from '@cashu/cashu-ts';
import type { Big } from 'big.js';
import { DomainError } from '../../errors';
import { decodeBolt11, parseBolt11Invoice } from '../../internal/lib/bolt11';
import {
  getCashuUnit,
  matchBlindSignaturesToOutputData,
  sumProofs,
  toProof,
} from '../../internal/lib/cashu';
import type { CashuSendQuoteRepository } from '../../internal/repositories/cashu-send-quote-repository';
import type { CashuAccount, CashuProof } from '../../types/account';
import type { CashuSendQuote, DestinationDetails } from '../../types/cashu';
import type { TransactionPurpose } from '../../types/transaction';

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
  meltQuote: MeltQuoteBolt11Response;
  /**
   * The amount that the receiver will receive.
   */
  amountToReceive: Money;
  /**
   * The maximum lightning network fee that will be charged for the send.
   * If the amount reserved is bigger than the actual fee, the difference will be returned to the sender as change.
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
  meltQuote: MeltQuoteBolt11Response;
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
      throw new DomainError('Invalid lightning invoice', 'invalid_invoice');
    }
    const invoice = bolt11ValidationResult.decoded;
    const expiresAt = invoice.expiryUnixMs
      ? new Date(invoice.expiryUnixMs)
      : null;

    if (expiresAt && expiresAt < new Date()) {
      throw new DomainError('Lightning invoice has expired', 'invalid_invoice');
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

    const unit = getCashuUnit(account.currency);

    const sumOfSendProofs = sumProofs(proofs);
    if (sumOfSendProofs < amountWithLightningFee) {
      throw new DomainError(
        `Insufficient balance. Estimated total including fee is ${amountToReceive.add(lightningFeeReserve).toLocaleString({ unit })}.`,
        'insufficient_balance',
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
    purpose,
    transferId,
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
    /**
     * The purpose of this transaction (e.g. a Cash App buy or an internal transfer).
     * When not provided, the transaction will be created with PAYMENT purpose.
     */
    purpose?: TransactionPurpose;
    /**
     * UUID linking paired send/receive transactions in a transfer.
     */
    transferId?: string;
  }): Promise<CashuSendQuote> {
    const meltQuote = sendQuote.meltQuote;
    const expiresAt = new Date(meltQuote.expiry * 1000);
    const now = new Date();

    if (now > expiresAt) {
      throw new DomainError('Quote has expired', 'expired');
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
    const unit = getCashuUnit(account.currency);

    if (proofsToSendSum < totalAmountToSend) {
      throw new DomainError(
        `Insufficient balance. Estimated total including fee is ${amountToReceive.add(estimatedTotalFee).toLocaleString({ unit })}.`,
        'insufficient_balance',
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
   * Initiates the send for the quote by calling the mint's melt proofs endpoint.
   * @throws An error if the account does not match the send quote account or the quote does not match the melt quote or the send quote is not unpaid.
   * @returns Melt proofs response from the mint.
   */
  async initiateSend(
    account: CashuAccount,
    sendQuote: CashuSendQuote,
    meltQuote: Pick<MeltQuoteBolt11Response, 'quote' | 'amount'>,
  ) {
    if (account.id !== sendQuote.accountId) {
      throw new DomainError('Account does not match', 'account_mismatch');
    }

    if (sendQuote.quoteId !== meltQuote.quote) {
      throw new DomainError('Quote does not match', 'quote_mismatch');
    }

    if (sendQuote.state !== 'UNPAID') {
      throw new DomainError(
        `Send is not unpaid. Current state: ${sendQuote.state}`,
        'invalid_state',
      );
    }

    const wallet = account.wallet;

    return wallet.meltProofsIdempotent(
      meltQuote,
      sendQuote.proofs.map((p) => toProof(p)),
      {
        keysetId: sendQuote.keysetId,
      },
      {
        type: 'deterministic',
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
  async markSendQuoteAsPending(quote: CashuSendQuote): Promise<CashuSendQuote> {
    if (quote.state === 'PENDING') {
      return quote;
    }

    if (quote.state !== 'UNPAID') {
      throw new DomainError(
        `Only unpaid cashu send quote can be marked as pending. Current state: ${quote.state}`,
        'invalid_state',
      );
    }

    return this.cashuSendRepository.markAsPending(quote.id);
  }

  /**
   * Completes the send quote after successful payment.
   * If the send quote is already paid, it's a no-op that returns back passed quote.
   * @throws An error if the account does not match the send quote account or the quote does not match the melt quote or the send quote is not pending or unpaid.
   * @returns The updated send quote.
   */
  async completeSendQuote(
    account: CashuAccount,
    sendQuote: CashuSendQuote,
    meltQuote: MeltQuoteBolt11Response,
  ): Promise<CashuSendQuote> {
    if (sendQuote.state === 'PAID') {
      return sendQuote;
    }

    if (!['PENDING', 'UNPAID'].includes(sendQuote.state)) {
      throw new DomainError(
        `Cannot complete send quote that is not pending or unpaid. Current state: ${sendQuote.state}`,
        'invalid_state',
      );
    }

    if (account.id !== sendQuote.accountId) {
      throw new DomainError(
        'Account does not match the quote account',
        'account_mismatch',
      );
    }

    if (meltQuote.quote !== sendQuote.quoteId) {
      throw new DomainError('Quote does not match', 'quote_mismatch');
    }

    if (meltQuote.state !== MeltQuoteState.PAID) {
      throw new DomainError(
        `Cannot complete send. Melt quote is not paid. Current state: ${meltQuote.state}`,
        'invalid_state',
      );
    }

    if (!meltQuote.payment_preimage) {
      console.warn('Payment preimage is missing on the melt quote');
    }

    const cashuUnit = getCashuUnit(account.currency);
    const wallet = account.wallet;

    // Re-derive the deterministic output data used for NUT-08 change blanks.
    // The change BlindSignatures from the mint may be in non-deterministic order
    // (both CDK and Nutshell return them from a SQL query without ORDER BY),
    // so we match them to OutputData via DLEQ verification rather than positional pairing.
    // See https://github.com/cashubtc/cashu-ts/issues/287 for why we re-derive OutputData here.
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
   * Fails the send quote after failed payment.
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
      throw new DomainError(
        `Cannot fail send quote that is not pending or unpaid. Current state: ${quote.state}`,
        'invalid_state',
      );
    }

    if (account.id !== quote.accountId) {
      throw new DomainError(
        'Account does not match the quote account',
        'account_mismatch',
      );
    }

    const latestMeltQuote = await account.wallet.checkMeltQuoteBolt11(
      quote.quoteId,
    );
    if (latestMeltQuote.state !== MeltQuoteState.UNPAID) {
      // Pending and paid melt quotes should not be failed because that means the send is in progress or has already been completed.
      // If the mint fails to pay the melt quote, then the melt quote state will be changed to UNPAID again.
      throw new DomainError(
        `Cannot fail melt quote that is not unpaid. Current state for send quote ${quote.id}: ${latestMeltQuote.state}`,
        'invalid_state',
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
      throw new DomainError(
        'Cannot expire quote that is not unpaid',
        'invalid_state',
      );
    }

    if (new Date(quote.expiresAt) > new Date()) {
      throw new DomainError(
        'Cannot expire quote that has not expired yet',
        'not_expired',
      );
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
        throw new DomainError('Proof not found', 'invalid_state');
      }
      return proof;
    });

    return {
      proofs: selectedProofs,
      fee: account.wallet.getFeesForProofs(send),
    };
  }
}
