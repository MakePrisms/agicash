import type { SparkWallet } from '@buildonspark/spark-sdk';
import {
  type LightningReceiveRequest,
  LightningReceiveRequestStatus,
} from '@buildonspark/spark-sdk/types';
import type { Money } from '~/lib/money';
import { moneyFromSparkAmount } from '~/lib/spark';
import type { SparkAccount } from '../accounts/account';
import { NotFoundError } from '../shared/error';

export type SparkLightningReceive = {
  id: string;
  createdAt: string;
  paymentRequest: string;
  preimage?: string;
  updatedAt: string;
  state: 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';
  amount: Money;
};

type CreateSparkLightningReceiveParams = {
  /**
   * The Spark account to create the receive request for.
   */
  account: SparkAccount;
  /**
   * The amount to receive.
   */
  amount: Money;
  /**
   * The Spark public key of the receiver. Used to create invoices on behalf of another user.
   * If provided, the incoming payment can only be claimed by the Spark wallet that controls the specified public key
   * If not provided, the invoice will be created for the user that owns the Spark wallet.
   */
  receiverIdentityPubkey?: string;
};

export class SparkLightningReceiveService {
  /**
   * Creates a new Spark Lightning Receive Request for the given amount.
   * The amount will be converted to sats if the currency is not BTC.
   * @throws Error if the exchange rate is required for non-BTC amounts and not provided
   */
  async create({
    account,
    amount,
    receiverIdentityPubkey,
  }: CreateSparkLightningReceiveParams): Promise<SparkLightningReceive> {
    const wallet = this.getSparkWalletOrThrow(account);

    const request = await wallet.createLightningInvoice({
      amountSats: amount.toNumber('sat'),
      includeSparkAddress: false,
      receiverIdentityPubkey,
    });

    return this.toSparkLightningReceive(request);
  }

  /**
   * Gets a Spark Lightning Receive Request by ID.
   * @param account - The Spark account to get the receive request for.
   * @param requestId - The ID of the Spark Lightning Receive Request
   * @throws NotFoundError if the request is not found
   */
  async get(
    account: SparkAccount,
    requestId: string,
  ): Promise<SparkLightningReceive> {
    const wallet = this.getSparkWalletOrThrow(account);
    const request = await wallet.getLightningReceiveRequest(requestId);
    if (!request) {
      throw new NotFoundError(`Spark request ${requestId} not found`);
    }
    return this.toSparkLightningReceive(request);
  }

  private toSparkLightningReceive(
    request: LightningReceiveRequest,
  ): SparkLightningReceive {
    const state = SparkLightningReceiveService.toState(request);
    const amount = moneyFromSparkAmount(request.invoice.amount);
    return {
      id: request.id,
      createdAt: request.createdAt,
      paymentRequest: request.invoice.encodedInvoice,
      preimage: request.paymentPreimage,
      updatedAt: request.updatedAt,
      state,
      amount,
    };
  }

  /**
   * Maps a Spark Lightning Receive Request to a simplified state.
   */
  private static toState(
    request: LightningReceiveRequest,
  ): SparkLightningReceive['state'] {
    if (request.invoice.expiresAt < new Date().toISOString()) {
      return 'EXPIRED';
    }
    switch (request.status) {
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

  private getSparkWalletOrThrow(account: SparkAccount): SparkWallet {
    if (!account.wallet) {
      throw new Error(`Spark account ${account.id} wallet not initialized`);
    }
    return account.wallet;
  }
}

export function useSparkLightningReceiveService() {
  return new SparkLightningReceiveService();
}
