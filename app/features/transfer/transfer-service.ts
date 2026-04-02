import type {
  Account,
  CashuAccount,
  SparkAccount,
} from '@agicash/sdk/features/accounts/account';
import {
  canReceiveFromLightning,
  canSendToLightning,
} from '@agicash/sdk/features/accounts/account';
import type { CashuReceiveQuote } from '@agicash/sdk/features/receive/cashu-receive-quote';
import type { SparkReceiveQuote } from '@agicash/sdk/features/receive/spark-receive-quote';
import { DomainError } from '@agicash/sdk/features/shared/error';
import { Money } from '@agicash/sdk/lib/money/index';
import type { CashuReceiveLightningQuote } from '../receive/cashu-receive-quote-core';
import type { CashuReceiveQuoteService } from '../receive/cashu-receive-quote-service';
import { useCashuReceiveQuoteService } from '../receive/cashu-receive-quote-service';
import { getLightningQuote as getSparkLightningQuote } from '../receive/spark-receive-quote-core';
import type { SparkReceiveLightningQuote } from '../receive/spark-receive-quote-core';
import type { SparkReceiveQuoteService } from '../receive/spark-receive-quote-service';
import { useSparkReceiveQuoteService } from '../receive/spark-receive-quote-service';
import type {
  CashuLightningQuote,
  CashuSendQuoteService,
} from '../send/cashu-send-quote-service';
import { useCashuSendQuoteService } from '../send/cashu-send-quote-service';
import type {
  SparkLightningQuote,
  SparkSendQuoteService,
} from '../send/spark-send-quote-service';
import { useSparkSendQuoteService } from '../send/spark-send-quote-service';

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

export type TransferQuote = {
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
    .encodedInvoice;
}

export class TransferService {
  constructor(
    private readonly cashuReceiveQuoteService: CashuReceiveQuoteService,
    private readonly sparkReceiveQuoteService: SparkReceiveQuoteService,
    private readonly cashuSendQuoteService: CashuSendQuoteService,
    private readonly sparkSendQuoteService: SparkSendQuoteService,
  ) {}

  /**
   * Gets a transfer quote for the given amount.
   * This only fetches the lightning quotes and does not persist them.
   * @param sourceAccount - The account sending the money.
   * @param destinationAccount - The account receiving the money.
   * @param amount - The amount to transfer.
   * @returns A transfer quote.
   * @throws An error if the source account cannot send Lightning payments or the destination account cannot receive Lightning payments.
   */
  async getTransferQuote({
    sourceAccount,
    destinationAccount,
    amount,
  }: {
    sourceAccount: Account;
    destinationAccount: Account;
    amount: Money;
  }): Promise<TransferQuote> {
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
   * Initiates a transfer by persisting the receive and send quotes.
   * The task processing will pick up the created send quote and initiate the send.
   * @param userId - The ID of the user initiating the transfer.
   * @param quote - The quote to initiate the transfer with.
   * @returns The transfer ID and both send/receive transaction IDs.
   * @throws An error if the receive or send quote fails to persist.
   */
  async initiateTransfer({
    userId,
    quote,
  }: {
    userId: string;
    quote: TransferQuote;
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

export function useTransferService() {
  const cashuReceiveQuoteService = useCashuReceiveQuoteService();
  const sparkReceiveQuoteService = useSparkReceiveQuoteService();
  const cashuSendQuoteService = useCashuSendQuoteService();
  const sparkSendQuoteService = useSparkSendQuoteService();
  return new TransferService(
    cashuReceiveQuoteService,
    sparkReceiveQuoteService,
    cashuSendQuoteService,
    sparkSendQuoteService,
  );
}
