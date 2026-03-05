import { Money } from '~/lib/money';
import type { Account, CashuAccount } from '../accounts/account';
import {
  canReceiveFromLightning,
  canSendToLightning,
} from '../accounts/account';
import type { AgicashDb } from '../agicash-db/database';
import { agicashDbClient } from '../agicash-db/database.client';
import type { CashuReceiveQuote } from '../receive/cashu-receive-quote';
import type { CashuReceiveLightningQuote } from '../receive/cashu-receive-quote-core';
import {
  type CashuReceiveQuoteService,
  useCashuReceiveQuoteService,
} from '../receive/cashu-receive-quote-service';
import type { SparkReceiveQuote } from '../receive/spark-receive-quote';
import {
  type SparkReceiveLightningQuote,
  getLightningQuote as getSparkLightningQuote,
} from '../receive/spark-receive-quote-core';
import {
  type SparkReceiveQuoteService,
  useSparkReceiveQuoteService,
} from '../receive/spark-receive-quote-service';
import type { CashuSendQuote } from '../send/cashu-send-quote';
import {
  type CashuLightningQuote,
  type CashuSendQuoteService,
  useCashuSendQuoteService,
} from '../send/cashu-send-quote-service';
import type { SparkSendQuote } from '../send/spark-send-quote';
import {
  type SparkLightningQuote,
  type SparkSendQuoteService,
  useSparkSendQuoteService,
} from '../send/spark-send-quote-service';
import { DomainError } from '../shared/error';

export type ReceiveLightningQuote =
  | { type: 'cashu'; quote: CashuReceiveLightningQuote }
  | { type: 'spark'; quote: SparkReceiveLightningQuote };

export type TransferQuote = {
  receiveLightningQuote: ReceiveLightningQuote;
  sendQuote: SparkLightningQuote | CashuLightningQuote;
  sourceAccountId: string;
  destinationAccountId: string;
  amount: Money;
  estimatedFee: Money;
  estimatedTotal: Money;
};

type GetTransferQuoteParams = {
  sourceAccount: Account;
  destinationAccount: Account;
  amount: Money;
};

type InitiateTransferParams = {
  userId: string;
  sourceAccount: Account;
  destinationAccount: Account;
  transferQuote: TransferQuote;
};

type InitiateTransferResult = {
  sendTransactionId: string;
  receiveTransactionId: string;
  sendQuote: SparkSendQuote | CashuSendQuote;
  receiveQuote: CashuReceiveQuote | SparkReceiveQuote;
};

export class TransferService {
  constructor(
    private readonly db: AgicashDb,
    private readonly cashuReceiveQuoteService: CashuReceiveQuoteService,
    private readonly sparkReceiveQuoteService: SparkReceiveQuoteService,
    private readonly sparkSendQuoteService: SparkSendQuoteService,
    private readonly cashuSendQuoteService: CashuSendQuoteService,
  ) {}

  async getTransferQuote({
    sourceAccount,
    destinationAccount,
    amount,
  }: GetTransferQuoteParams): Promise<TransferQuote> {
    if (!canSendToLightning(sourceAccount)) {
      throw new DomainError('Source account cannot send to Lightning');
    }

    if (!canReceiveFromLightning(destinationAccount)) {
      throw new DomainError(
        'Destination account cannot receive from Lightning',
      );
    }

    if (sourceAccount.currency !== destinationAccount.currency) {
      throw new DomainError(
        'Source and destination accounts must have the same currency',
      );
    }

    const receiveLightningQuote = await this.getReceiveQuote(
      destinationAccount,
      amount,
    );

    const paymentRequest = getPaymentRequest(receiveLightningQuote);
    const receiveFee = getReceiveFee(receiveLightningQuote, amount.currency);

    const sendQuote = await this.getSendQuote(sourceAccount, paymentRequest);

    const estimatedFee = receiveFee.add(sendQuote.estimatedTotalFee);
    const estimatedTotal = amount.add(estimatedFee);

    return {
      receiveLightningQuote,
      sendQuote,
      sourceAccountId: sourceAccount.id,
      destinationAccountId: destinationAccount.id,
      amount,
      estimatedFee,
      estimatedTotal,
    };
  }

  async initiateTransfer({
    userId,
    sourceAccount,
    destinationAccount,
    transferQuote,
  }: InitiateTransferParams): Promise<InitiateTransferResult> {
    const { receiveLightningQuote, sendQuote } = transferQuote;

    const receiveExpiresAt = getReceiveQuoteExpiry(receiveLightningQuote);
    if (new Date(receiveExpiresAt) < new Date()) {
      throw new DomainError('Transfer quote has expired. Please try again.');
    }

    if (sendQuote.expiresAt && sendQuote.expiresAt < new Date()) {
      throw new DomainError('Transfer quote has expired. Please try again.');
    }

    const receiveQuote = await this.createReceiveQuote(
      userId,
      destinationAccount,
      receiveLightningQuote,
    );

    let createdSendQuote: SparkSendQuote | CashuSendQuote;
    try {
      createdSendQuote = await this.createSendQuote(
        userId,
        sourceAccount,
        sendQuote,
      );
    } catch (error) {
      await this.failReceiveTransaction(receiveQuote.transactionId);
      throw error;
    }

    return {
      sendTransactionId: createdSendQuote.transactionId,
      receiveTransactionId: receiveQuote.transactionId,
      sendQuote: createdSendQuote,
      receiveQuote,
    };
  }

  private async getReceiveQuote(
    destinationAccount: Account,
    amount: Money,
  ): Promise<ReceiveLightningQuote> {
    if (destinationAccount.type === 'spark') {
      const quote = await getSparkLightningQuote({
        wallet: destinationAccount.wallet,
        amount,
      });
      return { type: 'spark', quote };
    }

    const quote = await this.cashuReceiveQuoteService.getLightningQuote({
      wallet: destinationAccount.wallet,
      amount,
    });
    return { type: 'cashu', quote };
  }

  private async createReceiveQuote(
    userId: string,
    destinationAccount: Account,
    receiveLightningQuote: ReceiveLightningQuote,
  ): Promise<CashuReceiveQuote | SparkReceiveQuote> {
    if (
      destinationAccount.type === 'spark' &&
      receiveLightningQuote.type === 'spark'
    ) {
      return this.sparkReceiveQuoteService.createReceiveQuote({
        userId,
        account: destinationAccount,
        lightningQuote: receiveLightningQuote.quote,
        receiveType: 'TRANSFER',
      });
    }

    if (
      destinationAccount.type === 'cashu' &&
      receiveLightningQuote.type === 'cashu'
    ) {
      return this.cashuReceiveQuoteService.createReceiveQuote({
        userId,
        account: destinationAccount,
        lightningQuote: receiveLightningQuote.quote,
        receiveType: 'TRANSFER',
      });
    }

    throw new Error(
      `Mismatched destination account type (${destinationAccount.type}) and receive quote type (${receiveLightningQuote.type})`,
    );
  }

  private async getSendQuote(
    sourceAccount: Account,
    paymentRequest: string,
  ): Promise<SparkLightningQuote | CashuLightningQuote> {
    if (sourceAccount.type === 'spark') {
      return this.sparkSendQuoteService.getLightningSendQuote({
        account: sourceAccount,
        paymentRequest,
      });
    }

    return this.cashuSendQuoteService.getLightningQuote({
      account: sourceAccount,
      paymentRequest,
    });
  }

  private async createSendQuote(
    userId: string,
    sourceAccount: Account,
    sendQuote: SparkLightningQuote | CashuLightningQuote,
  ): Promise<SparkSendQuote | CashuSendQuote> {
    if (sourceAccount.type === 'spark') {
      return this.sparkSendQuoteService.createSendQuote({
        userId,
        account: sourceAccount,
        quote: sendQuote as SparkLightningQuote,
      });
    }

    const cashuQuote = sendQuote as CashuLightningQuote;
    return this.cashuSendQuoteService.createSendQuote({
      userId,
      account: sourceAccount as CashuAccount,
      sendQuote: {
        paymentRequest: cashuQuote.paymentRequest,
        amountRequested: cashuQuote.amountRequested,
        amountRequestedInBtc: cashuQuote.amountRequestedInBtc,
        meltQuote: cashuQuote.meltQuote,
      },
    });
  }

  private async failReceiveTransaction(transactionId: string): Promise<void> {
    const { error } = await this.db
      .from('transactions')
      .update({ state: 'FAILED', failed_at: new Date().toISOString() })
      .eq('id', transactionId)
      .eq('state', 'PENDING');

    if (error) {
      console.error(
        `Failed to mark receive transaction ${transactionId} as FAILED`,
        { cause: error },
      );
    }
  }
}

function getPaymentRequest(quote: ReceiveLightningQuote): string {
  if (quote.type === 'spark') {
    return quote.quote.invoice.encodedInvoice;
  }
  return quote.quote.mintQuote.request;
}

function getReceiveFee(
  quote: ReceiveLightningQuote,
  currency: Money['currency'],
): Money {
  if (quote.type === 'spark') {
    return Money.zero(currency);
  }
  return quote.quote.mintingFee ?? Money.zero(currency);
}

function getReceiveQuoteExpiry(quote: ReceiveLightningQuote): string {
  if (quote.type === 'spark') {
    return quote.quote.invoice.expiresAt;
  }
  return quote.quote.expiresAt;
}

export function useTransferService() {
  const cashuReceiveQuoteService = useCashuReceiveQuoteService();
  const sparkReceiveQuoteService = useSparkReceiveQuoteService();
  const sparkSendQuoteService = useSparkSendQuoteService();
  const cashuSendQuoteService = useCashuSendQuoteService();
  return new TransferService(
    agicashDbClient,
    cashuReceiveQuoteService,
    sparkReceiveQuoteService,
    sparkSendQuoteService,
    cashuSendQuoteService,
  );
}
