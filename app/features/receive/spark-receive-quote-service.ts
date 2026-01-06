import type { SparkWallet } from '@buildonspark/spark-sdk';
import type { Proof } from '@cashu/cashu-ts';
import type { Money } from '~/lib/money';
import { moneyFromSparkAmount } from '~/lib/spark';
import type { SparkAccount } from '../accounts/account';
import type { SparkReceiveQuote } from './spark-receive-quote';
import {
  type SparkReceiveQuoteRepository,
  useSparkReceiveQuoteRepository,
} from './spark-receive-quote-repository';

export type SparkReceiveLightningQuote = Awaited<
  ReturnType<SparkWallet['createLightningInvoice']>
>;

type GetLightningQuoteParams = {
  /**
   * The Spark account to which the money will be received.
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
};

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
   * The lightning quote to create the Spark receive quote from.
   */
  lightningQuote: SparkReceiveLightningQuote;
} & (
  | {
      /**
       * Type of the receive.
       * LIGHTNING - Standard lightning receive.
       */
      type?: 'LIGHTNING';
    }
  | {
      /**
       * Type of the receive.
       * CASHU_TOKEN - Receive cashu tokens to a Spark account.
       */
      type: 'CASHU_TOKEN';
      /**
       * URL of the source mint where the token proofs originate from.
       */
      sourceMintUrl: string;
      /**
       * The proofs from the source cashu token that will be melted.
       */
      tokenProofs: Proof[];
      /**
       * ID of the melt quote on the source mint.
       */
      meltQuoteId: string;
      /**
       * The expiry of the melt quote in ISO 8601 format.
       */
      meltQuoteExpiresAt: string;
    }
);

export class SparkReceiveQuoteService {
  constructor(private readonly repository: SparkReceiveQuoteRepository) {}

  /**
   * Gets a Spark lightning receive quote for the given amount.
   * @returns The Spark lightning receive quote.
   */
  async getLightningQuote({
    account,
    amount,
    receiverIdentityPubkey,
  }: GetLightningQuoteParams): Promise<SparkReceiveLightningQuote> {
    return account.wallet.createLightningInvoice({
      amountSats: amount.toNumber('sat'),
      includeSparkAddress: false,
      receiverIdentityPubkey,
    });
  }

  /**
   * Creates a new Spark Lightning receive quote for the given amount.
   * This creates a lightning invoice via Spark and stores the quote in the database.
   */
  async createReceiveQuote(
    params: CreateQuoteParams,
  ): Promise<SparkReceiveQuote> {
    const { userId, account, lightningQuote } = params;

    const expiresAt =
      params.type === 'CASHU_TOKEN'
        ? new Date(
            Math.min(
              new Date(lightningQuote.invoice.expiresAt).getTime(),
              new Date(params.meltQuoteExpiresAt).getTime(),
            ),
          ).toISOString()
        : lightningQuote.invoice.expiresAt;

    const baseParams = {
      userId,
      accountId: account.id,
      amount: moneyFromSparkAmount(lightningQuote.invoice.amount),
      paymentRequest: lightningQuote.invoice.encodedInvoice,
      paymentHash: lightningQuote.invoice.paymentHash,
      expiresAt,
      sparkId: lightningQuote.id,
      receiverIdentityPubkey: lightningQuote.receiverIdentityPublicKey,
    };

    if (params.type === 'CASHU_TOKEN') {
      return this.repository.create({
        ...baseParams,
        type: 'CASHU_TOKEN',
        sourceMintUrl: params.sourceMintUrl,
        tokenProofs: params.tokenProofs,
        meltQuoteId: params.meltQuoteId,
      });
    }

    return this.repository.create({
      ...baseParams,
      type: 'LIGHTNING',
    });
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

  /**
   * Fails the spark receive quote by marking it as failed.
   * It's a no-op if the quote is already failed.
   * @param quote - The spark receive quote to fail.
   * @param reason - The reason for the failure.
   * @throws An error if the quote is not in UNPAID state.
   */
  async fail(quote: SparkReceiveQuote, reason: string): Promise<void> {
    if (quote.state === 'FAILED') {
      return;
    }

    if (quote.state !== 'UNPAID') {
      throw new Error(
        `Cannot fail quote that is not unpaid. State: ${quote.state}`,
      );
    }

    await this.repository.fail({ id: quote.id, reason });
  }

  /**
   * Marks the melt as initiated for a CASHU_TOKEN type cashu receive quote.
   * It's a no-op if the melt was already marked as initiated.
   * @param quote - The spark receive quote of type CASHU_TOKEN.
   * @returns The updated quote.
   * @throws An error if the quote is not of type TOKEN or is not in UNPAID state.
   */
  async markMeltInitiated(
    quote: SparkReceiveQuote & { type: 'CASHU_TOKEN' },
  ): Promise<SparkReceiveQuote & { type: 'CASHU_TOKEN' }> {
    if (quote.type !== 'CASHU_TOKEN') {
      throw new Error('Invalid quote type. Quote must be of type CASHU_TOKEN.');
    }

    if (quote.tokenReceiveData.meltInitiated) {
      return quote;
    }

    if (quote.state !== 'UNPAID') {
      throw new Error(
        `Invalid quote state. Quote must be in UNPAID state. State: ${quote.state}`,
      );
    }

    return this.repository.markMeltInitiated(quote);
  }
}

export function useSparkReceiveQuoteService() {
  const repository = useSparkReceiveQuoteRepository();
  return new SparkReceiveQuoteService(repository);
}
