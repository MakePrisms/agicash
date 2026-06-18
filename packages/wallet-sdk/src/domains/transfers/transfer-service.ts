import { Money } from '@agicash/money';
import { DomainError } from '../../errors';
import type { Account, CashuAccount, SparkAccount } from '../../types/account';
import type { CashuReceiveQuote } from '../../types/cashu';
import type { SparkReceiveQuote } from '../../types/spark';
import {
  canReceiveFromLightning,
  canSendToLightning,
} from '../accounts/account-utils';
import type { CashuReceiveLightningQuote } from '../cashu/cashu-receive-quote-core';
import type { CashuReceiveQuoteService } from '../cashu/cashu-receive-quote-service';
import type {
  CashuLightningQuote,
  CashuSendQuoteService,
} from '../cashu/cashu-send-quote-service';
import type { SparkReceiveLightningQuote } from '../spark/spark-receive-quote-core';
import { getLightningQuote as getSparkLightningQuote } from '../spark/spark-receive-quote-core';
import type { SparkReceiveQuoteService } from '../spark/spark-receive-quote-service';
import type {
  SparkLightningQuote,
  SparkSendQuoteService,
} from '../spark/spark-send-quote-service';

export type TransferReceiveSide =
  | {
      account: CashuAccount;
      fee: Money;
      lightningQuote: CashuReceiveLightningQuote;
    }
  | {
      account: SparkAccount;
      fee: Money;
      lightningQuote: SparkReceiveLightningQuote;
    };

export type TransferSendSide =
  | { account: CashuAccount; lightningQuote: CashuLightningQuote }
  | { account: SparkAccount; lightningQuote: SparkLightningQuote };

export type InternalTransferQuote = {
  amount: Money;
  amountToReceive: Money;
  totalFees: Money;
  totalCost: Money;
  receive: TransferReceiveSide;
  send: TransferSendSide;
};

function extractPaymentRequest(receive: TransferReceiveSide): string {
  if (receive.account.type === 'cashu') {
    return (receive.lightningQuote as CashuReceiveLightningQuote).mintQuote
      .request;
  }
  return (receive.lightningQuote as SparkReceiveLightningQuote).invoice
    .paymentRequest;
}

/** Internal transfer orchestration (rich sides). The transfers domain maps to the slim contract shape. */
export class TransferService {
  constructor(
    private readonly cashuReceiveQuoteService: CashuReceiveQuoteService,
    private readonly sparkReceiveQuoteService: SparkReceiveQuoteService,
    private readonly cashuSendQuoteService: CashuSendQuoteService,
    private readonly sparkSendQuoteService: SparkSendQuoteService,
  ) {}

  async getTransferQuote({
    sourceAccount,
    destinationAccount,
    amount,
  }: {
    sourceAccount: Account;
    destinationAccount: Account;
    amount: Money;
  }): Promise<InternalTransferQuote> {
    if (!canSendToLightning(sourceAccount)) {
      throw new DomainError(
        `${sourceAccount.name} cannot send Lightning payments`,
        'CANNOT_SEND_LIGHTNING',
      );
    }
    if (!canReceiveFromLightning(destinationAccount)) {
      throw new DomainError(
        `${destinationAccount.name} cannot receive Lightning payments`,
        'CANNOT_RECEIVE_LIGHTNING',
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

  async initiateTransfer({
    userId,
    quote,
  }: {
    userId: string;
    quote: InternalTransferQuote;
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
      lightningQuote: await getSparkLightningQuote({
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
