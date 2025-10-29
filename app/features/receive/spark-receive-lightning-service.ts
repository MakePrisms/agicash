import {
  type LightningReceiveRequest,
  LightningReceiveRequestStatus,
} from '@buildonspark/spark-sdk/types';
import type { Money } from '~/lib/money';
import type { SparkAccount } from '../accounts/account';

export type SparkReceiveQuote = {
  id: string;
  accountId: string;
  amount: Money;
  paymentRequest: string;
  receiveRequest: LightningReceiveRequest;
  state: 'PENDING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  transferId?: string;
};

export class SparkReceiveLightningService {
  async getLightningQuote({
    account,
    amount,
    receiverIdentityPubkey,
  }: {
    account: SparkAccount;
    amount: Money;
    /** The Spark public key of the receive. This will generate an invoice on behalf of the receiver. */
    receiverIdentityPubkey?: string;
  }): Promise<SparkReceiveQuote> {
    const sparkWallet = account.wallet;
    const receiveRequest = await sparkWallet.createLightningInvoice({
      amountSats: amount.toNumber('sat'),
      memo: '',
      includeSparkAddress: false,
      receiverIdentityPubkey,
    });

    return {
      id: receiveRequest.id,
      accountId: account.id,
      amount,
      paymentRequest: receiveRequest.invoice.encodedInvoice,
      receiveRequest,
      state: 'PENDING',
      createdAt: receiveRequest.createdAt,
    };
  }

  async getPaymentStatus(
    account: SparkAccount,
    invoiceId: string,
  ): Promise<SparkReceiveQuote['state']> {
    const sparkWallet = account.wallet;
    const status = await sparkWallet.getLightningReceiveRequest(invoiceId);
    if (!status) {
      throw new Error('Spark invoice not found');
    }

    // Map Spark status to simplified status
    switch (status.status) {
      case LightningReceiveRequestStatus.TRANSFER_COMPLETED:
        return 'COMPLETED';
      case LightningReceiveRequestStatus.TRANSFER_FAILED:
      case LightningReceiveRequestStatus.TRANSFER_CREATION_FAILED:
      case LightningReceiveRequestStatus.REFUND_SIGNING_COMMITMENTS_QUERYING_FAILED:
      case LightningReceiveRequestStatus.REFUND_SIGNING_FAILED:
      case LightningReceiveRequestStatus.PAYMENT_PREIMAGE_RECOVERING_FAILED:
        return 'FAILED';
      case LightningReceiveRequestStatus.INVOICE_CREATED:
      case LightningReceiveRequestStatus.TRANSFER_CREATED:
      case LightningReceiveRequestStatus.PAYMENT_PREIMAGE_RECOVERED:
      case LightningReceiveRequestStatus.LIGHTNING_PAYMENT_RECEIVED:
      case LightningReceiveRequestStatus.FUTURE_VALUE:
        return 'PENDING';
      default:
        throw new Error('Unknown Spark invoice status');
    }
  }
}

export function useSparkReceiveLightningService() {
  return new SparkReceiveLightningService();
}
