import type { Money } from '~/lib/money';
import type {
  AgicashDb,
  AgicashDbSparkReceiveQuote,
} from '../agicash-db/database';
import { agicashDbClient } from '../agicash-db/database.client';
import { type Encryption, useEncryption } from '../shared/encryption';
import type {
  CompletedSparkLightningReceiveTransactionDetails,
  SparkLightningReceiveTransactionDetails,
} from '../transactions/transaction';
import {} from '../transactions/transaction-repository';
import type { SparkReceiveQuote } from './spark-receive-quote';

type Options = {
  abortSignal?: AbortSignal;
};

type EncryptedData = {
  amount: Money;
  paymentRequest: string;
  paymentPreimage?: string;
};

type CreateQuoteParams = {
  /**
   * ID of the receiving user.
   */
  userId: string;
  /**
   * ID of the receiving account.
   */
  accountId: string;
  /**
   * Amount of the quote.
   */
  amount: Money;
  /**
   * Lightning payment request.
   */
  paymentRequest: string;
  /**
   * Payment hash of the lightning invoice.
   */
  paymentHash: string;
  /**
   * Expiry of the quote in ISO 8601 format.
   */
  expiresAt: string;
  /**
   * ID of the receive request in the Spark system.
   */
  sparkId: string;
  /**
   * Optional public key of the wallet receiving the lightning invoice.
   */
  receiverIdentityPubkey?: string;
  /**
   * Type of the receive.
   * - LIGHTNING - Standard lightning receive.
   * - CASHU_TOKEN - Receive cashu tokens to a Spark account.
   */
  type: 'LIGHTNING' | 'CASHU_TOKEN';
};

export class SparkReceiveQuoteRepository {
  constructor(
    private readonly db: AgicashDb,
    private readonly encryption: Encryption,
  ) {}

  /**
   * Creates a spark receive quote.
   * @returns Created spark receive quote.
   */
  async create(
    params: CreateQuoteParams,
    options?: Options,
  ): Promise<SparkReceiveQuote> {
    const {
      userId,
      accountId,
      amount,
      paymentRequest,
      paymentHash,
      expiresAt,
      sparkId,
      receiverIdentityPubkey,
      type,
    } = params;

    const details: SparkLightningReceiveTransactionDetails = {
      amountReceived: amount,
      paymentRequest,
    };

    const dataToEncrypt: EncryptedData = {
      amount,
      paymentRequest,
    };

    const [encryptedTransactionDetails, encryptedData] =
      await this.encryption.encryptBatch([details, dataToEncrypt]);

    const query = this.db.rpc('create_spark_receive_quote', {
      p_user_id: userId,
      p_account_id: accountId,
      p_currency: amount.currency,
      p_payment_hash: paymentHash,
      p_expires_at: expiresAt,
      p_spark_id: sparkId,
      p_receiver_identity_pubkey: receiverIdentityPubkey ?? null,
      p_encrypted_transaction_details: encryptedTransactionDetails,
      p_receive_type: type,
      p_encrypted_data: encryptedData,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to create spark receive quote', { cause: error });
    }

    return this.toQuote(data);
  }

  /**
   * Completes a spark receive quote by marking it as paid.
   * @returns The updated quote.
   */
  async complete(
    {
      quote,
      paymentPreimage,
      sparkTransferId,
    }: {
      /**
       * The spark receive quote to complete.
       */
      quote: SparkReceiveQuote;
      /**
       * Payment preimage of the lightning payment.
       */
      paymentPreimage: string;
      /**
       * ID of the transfer in Spark system.
       */
      sparkTransferId: string;
    },
    options?: Options,
  ): Promise<SparkReceiveQuote> {
    // sparkTransferId is stored to non encrypted transaction details.
    const transactionDetails: Omit<
      CompletedSparkLightningReceiveTransactionDetails,
      'sparkTransferId'
    > = {
      paymentRequest: quote.paymentRequest,
      amountReceived: quote.amount,
      paymentPreimage,
    };

    const dataToEncrypt: EncryptedData = {
      amount: quote.amount,
      paymentRequest: quote.paymentRequest,
      paymentPreimage,
    };

    const [encryptedTransactionDetails, encryptedData] =
      await this.encryption.encryptBatch([transactionDetails, dataToEncrypt]);

    const query = this.db.rpc('complete_spark_receive_quote', {
      p_quote_id: quote.id,
      p_spark_transfer_id: sparkTransferId,
      p_encrypted_transaction_details: encryptedTransactionDetails,
      p_encrypted_data: encryptedData,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to complete spark receive quote', {
        cause: error,
      });
    }

    return this.toQuote(data);
  }

  /**
   * Expires a spark receive quote.
   */
  async expire(quoteId: string, options?: Options): Promise<SparkReceiveQuote> {
    const query = this.db.rpc('expire_spark_receive_quote', {
      p_quote_id: quoteId,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to expire spark receive quote', { cause: error });
    }

    return this.toQuote(data);
  }

  /**
   * Gets the spark receive quote with the given id.
   * @param id - The id of the spark receive quote to get.
   * @returns The spark receive quote or null if it does not exist.
   */
  async get(id: string, options?: Options): Promise<SparkReceiveQuote | null> {
    const query = this.db.from('spark_receive_quotes').select().eq('id', id);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to get spark receive quote', { cause: error });
    }

    return data ? this.toQuote(data) : null;
  }

  /**
   * Gets all pending (unpaid) spark receive quotes for the given user.
   * @param userId - The id of the user to get the spark receive quotes for.
   * @returns The spark receive quotes.
   */
  async getPending(
    userId: string,
    options?: Options,
  ): Promise<SparkReceiveQuote[]> {
    const query = this.db
      .from('spark_receive_quotes')
      .select()
      .eq('user_id', userId)
      .eq('state', 'UNPAID');

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to get spark receive quotes', { cause: error });
    }

    return Promise.all(data.map((data) => this.toQuote(data)));
  }

  async toQuote(data: AgicashDbSparkReceiveQuote): Promise<SparkReceiveQuote> {
    const [decryptedData] = await this.encryption.decryptBatch<[EncryptedData]>(
      [data.encrypted_data],
    );

    const baseQuote = {
      id: data.id,
      type: data.type,
      sparkId: data.spark_id,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      amount: decryptedData.amount,
      paymentRequest: decryptedData.paymentRequest,
      paymentHash: data.payment_hash,
      receiverIdentityPubkey: data.receiver_identity_pubkey ?? undefined,
      transactionId: data.transaction_id,
      userId: data.user_id,
      accountId: data.account_id,
      version: data.version,
    };

    if (data.state === 'PAID') {
      if (!decryptedData.paymentPreimage || !data.spark_transfer_id) {
        throw new Error(
          'Invalid spark receive quote data. Payment preimage and spark transfer id are required for paid state.',
        );
      }

      return {
        ...baseQuote,
        state: 'PAID',
        paymentPreimage: decryptedData.paymentPreimage,
        sparkTransferId: data.spark_transfer_id,
      };
    }

    if (data.state === 'UNPAID' || data.state === 'EXPIRED') {
      return {
        ...baseQuote,
        state: data.state,
      };
    }

    throw new Error(`Unexpected quote state ${data.state}`);
  }
}

export function useSparkReceiveQuoteRepository() {
  const encryption = useEncryption();
  return new SparkReceiveQuoteRepository(agicashDbClient, encryption);
}
