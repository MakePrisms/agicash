/**
 * Internal transfer service — Slice 4 (transfers).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/transfer/transfer-service.ts`. Master's `TransferService` is
 * ALREADY a plain class taking the four quote services — only the `useTransferService()` factory
 * couples it to React. Here it takes the SDK's re-housed cashu/spark send + receive quote
 * services. All logic — the `canSendToLightning`/`canReceiveFromLightning` gates, fetching both
 * legs' lightning quotes, and `initiateTransfer`'s persist-receive → persist-send →
 * AUTO-FAIL-the-receive-on-send-fail (§9) — is verbatim from master.
 *
 * The transfer quote is the VERBATIM-FULL master shape — the public {@link TransferQuote} (§9):
 * each leg carries its live `lightningQuote` (the mint/Breez quote the send/receive persists from)
 * as a VISIBLE, plain-data field. {@link TransfersDomain.executeQuote} hands that full quote
 * straight back to {@link TransferService.initiateTransfer}, which reads the live legs directly
 * (no slim projection, no symbol carrier). {@link TransferQuoteInternal} is kept as an alias of
 * the public {@link TransferQuote} for back-compat with callers/tests that referenced it.
 *
 * @module
 */
import type { CashuReceiveLightningQuote } from './cashu-receive-quote-core';
import type {
  CashuLightningQuote,
  CashuSendQuoteService,
} from './cashu-send-quote-service';
import {
  canReceiveFromLightning,
  canSendToLightning,
} from './lib-transactions';
import type { CashuReceiveQuoteService } from './cashu-receive-quote-service';
import type { SparkReceiveLightningQuote } from './spark-receive-quote-core';
import { getLightningQuote as getSparkReceiveLightningQuote } from './spark-receive-quote-core';
import type { SparkReceiveQuoteService } from './spark-receive-quote-service';
import type {
  SparkLightningQuote,
  SparkSendQuoteService,
} from './spark-send-quote-service';
import { DomainError } from '../errors';
import type { Account } from '../types/account';
import type { CashuReceiveQuote } from '../types/cashu';
import { Money } from '../types/money';
import type { SparkReceiveQuote } from '../types/spark';
import type {
  TransferQuote,
  TransferReceiveSide,
  TransferSendSide,
} from '../types/transfer';

// The transfer leg shapes are the PUBLIC, verbatim-full master shapes (each leg carries its live
// `lightningQuote` as visible plain data). Re-exported here so the internal service + its tests
// keep their existing import surface.
export type { TransferReceiveSide, TransferSendSide } from '../types/transfer';

/**
 * The transfer quote — an ALIAS of the public {@link TransferQuote} (§9). Verbatim-full: both legs
 * carry their live `lightningQuote` as visible plain data; there is no slim projection. Kept as a
 * named alias for back-compat with callers/tests that referenced `TransferQuoteInternal`.
 */
export type TransferQuoteInternal = TransferQuote;

/** The bolt11 payment request the source leg must pay to fund the destination leg. */
function extractPaymentRequest(receive: TransferReceiveSide): string {
  if (receive.account.type === 'cashu') {
    return (receive.lightningQuote as CashuReceiveLightningQuote).mintQuote
      .request;
  }
  return (receive.lightningQuote as SparkReceiveLightningQuote).invoice
    .paymentRequest;
}

/**
 * Cross-account transfer orchestration (cashu↔spark via Lightning). Construct with the cashu +
 * spark receive + send quote services (the SDK-internal re-housed ones).
 */
export class TransferService {
  /**
   * @param cashuReceiveQuoteService - cashu receive (the destination cashu leg).
   * @param sparkReceiveQuoteService - spark receive (the destination spark leg).
   * @param cashuSendQuoteService - cashu send (the source cashu leg).
   * @param sparkSendQuoteService - spark send (the source spark leg).
   */
  constructor(
    private readonly cashuReceiveQuoteService: CashuReceiveQuoteService,
    private readonly sparkReceiveQuoteService: SparkReceiveQuoteService,
    private readonly cashuSendQuoteService: CashuSendQuoteService,
    private readonly sparkSendQuoteService: SparkSendQuoteService,
  ) {}

  /**
   * Build an internal transfer quote for `amount` from `sourceAccount` to `destinationAccount`.
   * Only fetches the lightning quotes (does NOT persist them). Verbatim from master
   * `getTransferQuote`.
   *
   * @param params - `{ sourceAccount, destinationAccount, amount }`.
   * @returns the internal transfer quote (with live legs).
   * @throws DomainError if the source cannot send / the destination cannot receive over Lightning.
   */
  async getTransferQuote({
    sourceAccount,
    destinationAccount,
    amount,
  }: {
    sourceAccount: Account;
    destinationAccount: Account;
    amount: Money;
  }): Promise<TransferQuoteInternal> {
    if (!canSendToLightning(sourceAccount)) {
      throw new DomainError(
        `${sourceAccount.name} cannot send Lightning payments`,
      );
    }
    if (!canReceiveFromLightning(destinationAccount)) {
      throw new DomainError(
        `${destinationAccount.name} cannot receive Lightning payments`,
      );
    }

    const receive = await this.getReceiveSide(destinationAccount, amount);
    const paymentRequest = extractPaymentRequest(receive);
    const send = await this.getSendSide(sourceAccount, paymentRequest);

    const amountToReceive = send.lightningQuote.amountToReceive;
    const totalFees = send.lightningQuote.estimatedTotalFee.add(receive.fee);
    const totalCost = amountToReceive.add(totalFees);

    return { amount, amountToReceive, totalFees, totalCost, receive, send };
  }

  /**
   * Initiate a transfer by persisting the receive then the send quote (linked by a fresh
   * `transferId`). The background processor picks up the created send quote and drives the send.
   * If the send quote fails to persist, the already-persisted receive quote is AUTO-FAILED so no
   * orphan credit is left (§9). Verbatim from master `initiateTransfer`.
   *
   * @param params - `{ userId, quote }` (the internal transfer quote).
   * @returns the `transferId` + both leg transaction ids.
   * @throws Error if the receive or send quote fails to persist.
   */
  async initiateTransfer({
    userId,
    quote,
  }: {
    userId: string;
    quote: TransferQuoteInternal;
  }): Promise<{
    transferId: string;
    receiveTransactionId: string;
    sendTransactionId: string;
  }> {
    const transferId = crypto.randomUUID();
    const { receive, send } = quote;

    const receiveQuote = await this.persistReceiveQuote(
      userId,
      receive,
      transferId,
    );

    try {
      const sendQuote = await this.persistSendQuote(userId, send, transferId);
      return {
        transferId,
        receiveTransactionId: receiveQuote.transactionId,
        sendTransactionId: sendQuote.transactionId,
      };
    } catch (error) {
      try {
        await this.failReceiveQuote(receive, receiveQuote);
      } catch (failError) {
        console.error('Failed to cleanup receive quote', {
          cause: failError,
          transferId,
          receiveAccountId: receive.account.id,
          sendAccountId: send.account.id,
        });
      }
      throw error;
    }
  }

  private async getReceiveSide(
    account: Account,
    amount: Money,
  ): Promise<TransferReceiveSide> {
    if (account.type === 'cashu') {
      const lightningQuote =
        await this.cashuReceiveQuoteService.getLightningQuote({
          wallet: account.wallet,
          amount,
        });
      return {
        account,
        fee: lightningQuote.mintingFee ?? Money.zero(amount.currency),
        lightningQuote,
      };
    }
    return {
      account,
      fee: Money.zero(amount.currency),
      lightningQuote: await getSparkReceiveLightningQuote({
        wallet: account.wallet,
        amount,
      }),
    };
  }

  private async getSendSide(
    account: Account,
    paymentRequest: string,
  ): Promise<TransferSendSide> {
    if (account.type === 'cashu') {
      return {
        account,
        lightningQuote: await this.cashuSendQuoteService.getLightningQuote({
          account,
          paymentRequest,
        }),
      };
    }
    return {
      account,
      lightningQuote: await this.sparkSendQuoteService.getLightningSendQuote({
        account,
        paymentRequest,
      }),
    };
  }

  private async persistReceiveQuote(
    userId: string,
    receive: TransferReceiveSide,
    transferId: string,
  ): Promise<CashuReceiveQuote | SparkReceiveQuote> {
    if (receive.account.type === 'cashu') {
      return this.cashuReceiveQuoteService.createReceiveQuote({
        userId,
        account: receive.account,
        lightningQuote: receive.lightningQuote as CashuReceiveLightningQuote,
        receiveType: 'LIGHTNING',
        purpose: 'TRANSFER',
        transferId,
      });
    }
    return this.sparkReceiveQuoteService.createReceiveQuote({
      userId,
      account: receive.account,
      lightningQuote: receive.lightningQuote as SparkReceiveLightningQuote,
      receiveType: 'LIGHTNING',
      purpose: 'TRANSFER',
      transferId,
    });
  }

  private async failReceiveQuote(
    receive: TransferReceiveSide,
    quote: CashuReceiveQuote | SparkReceiveQuote,
  ): Promise<void> {
    if (receive.account.type === 'cashu') {
      await this.cashuReceiveQuoteService.fail(
        quote as CashuReceiveQuote,
        'Transfer initiation failed',
      );
    } else {
      await this.sparkReceiveQuoteService.fail(
        quote as SparkReceiveQuote,
        'Transfer initiation failed',
      );
    }
  }

  private async persistSendQuote(
    userId: string,
    send: TransferSendSide,
    transferId: string,
  ): Promise<{ transactionId: string }> {
    if (send.account.type === 'cashu') {
      const quote = send.lightningQuote as CashuLightningQuote;
      return this.cashuSendQuoteService.createSendQuote({
        userId,
        account: send.account,
        sendQuote: {
          paymentRequest: quote.paymentRequest,
          amountRequested: quote.amountRequested,
          amountRequestedInBtc: quote.amountRequestedInBtc,
          meltQuote: quote.meltQuote,
        },
        purpose: 'TRANSFER',
        transferId,
      });
    }
    return this.sparkSendQuoteService.createSendQuote({
      userId,
      account: send.account,
      quote: send.lightningQuote as SparkLightningQuote,
      purpose: 'TRANSFER',
      transferId,
    });
  }
}
