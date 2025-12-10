import type { SparkWallet } from '@buildonspark/spark-sdk';
import type { Money } from '~/lib/money';
import { moneyFromSparkAmount } from '~/lib/spark';
import type { SparkAccount } from '../accounts/account';
import type { SparkReceiveQuote } from './spark-receive-quote';
import {
  type SparkReceiveQuoteRepository,
  useSparkReceiveQuoteRepository,
} from './spark-receive-quote-repository';

type CreateQuoteParams = {
  /**
   * The user ID.
   */
  userId: string;
  /**
   * The Spark account to create the receive request for.
   */
  account: SparkAccount;
  /**
   * The amount to receive.
   */
  amount: Money;
  /**
   * The Spark public key of the receiver used to create invoices on behalf of another user.
   * If provided, the incoming payment can only be claimed by the Spark wallet that controls the specified public key.
   * If not provided, the invoice will be created for the user that owns the Spark wallet.
   */
  receiverIdentityPubkey?: string;
  /**
   * Type of the receive.
   * - LIGHTNING - Standard lightning receive.
   * - CASHU_TOKEN - Receive cashu tokens to a Spark account.
   * Default is LIGHTNING.
   */
  type?: 'LIGHTNING' | 'CASHU_TOKEN';
};

export class SparkReceiveQuoteService {
  constructor(private readonly repository: SparkReceiveQuoteRepository) {}

  /**
   * Creates a new Spark Lightning receive quote for the given amount.
   * This creates a lightning invoice via Spark and stores the quote in the database.
   */
  async createQuote({
    userId,
    account,
    amount,
    receiverIdentityPubkey,
    type = 'LIGHTNING',
  }: CreateQuoteParams): Promise<SparkReceiveQuote> {
    const wallet = this.getSparkWalletOrThrow(account);

    const request = await wallet.createLightningInvoice({
      amountSats: amount.toNumber('sat'),
      includeSparkAddress: false,
      receiverIdentityPubkey,
    });

    const quote = await this.repository.create({
      userId,
      accountId: account.id,
      amount: moneyFromSparkAmount(request.invoice.amount),
      paymentRequest: request.invoice.encodedInvoice,
      paymentHash: request.invoice.paymentHash,
      expiresAt: request.invoice.expiresAt,
      sparkId: request.id,
      receiverIdentityPubkey,
      type,
    });

    return quote;
  }

  /**
   * Gets a Spark receive quote by ID.
   * @param quoteId - The ID of the quote.
   * @returns The quote or null if not found.
   */
  async get(quoteId: string): Promise<SparkReceiveQuote | null> {
    return this.repository.get(quoteId);
  }

  /**
   * Completes the spark receive quote by marking it as paid.
   * It's a no-op if the quote is already paid.
   * @param quote - The spark receive quote to complete.
   * @param paymentPreimage - The payment preimage from the lightning payment.
   * @param sparkTransferId - The Spark transfer ID from the completed transfer.
   * @returns The updated quote.
   * @throws An error if the quote is not in UNPAID state.
   */
  async complete(
    quote: SparkReceiveQuote,
    paymentPreimage: string,
    sparkTransferId: string,
  ): Promise<SparkReceiveQuote> {
    if (quote.state === 'PAID') {
      return quote;
    }

    if (quote.state !== 'UNPAID') {
      throw new Error(
        `Cannot complete quote that is not unpaid. State: ${quote.state}`,
      );
    }

    return this.repository.complete({
      quote,
      paymentPreimage,
      sparkTransferId,
    });
  }

  /**
   * Expires the spark receive quote by marking it as expired.
   * It's a no-op if the quote is already expired.
   * @param quote - The spark receive quote to expire.
   * @throws An error if the quote is not in UNPAID state or has not expired yet.
   */
  async expire(quote: SparkReceiveQuote): Promise<void> {
    if (quote.state === 'EXPIRED') {
      return;
    }

    if (quote.state !== 'UNPAID') {
      throw new Error(
        `Cannot expire quote that is not unpaid. State: ${quote.state}`,
      );
    }

    if (new Date(quote.expiresAt) > new Date()) {
      throw new Error('Cannot expire quote that has not expired yet');
    }

    await this.repository.expire(quote.id);
  }

  private getSparkWalletOrThrow(account: SparkAccount): SparkWallet {
    if (!account.wallet) {
      throw new Error(`Spark account ${account.id} wallet not initialized`);
    }
    return account.wallet;
  }
}

export function useSparkReceiveQuoteService() {
  const repository = useSparkReceiveQuoteRepository();
  return new SparkReceiveQuoteService(repository);
}
