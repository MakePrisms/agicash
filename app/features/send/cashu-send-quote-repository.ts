import type { Proof } from '@cashu/cashu-ts';
import { sumProofs } from '~/lib/cashu';
import { Money } from '~/lib/money';
import {
  type AgicashDb,
  type AgicashDbCashuSendQuote,
  agicashDb,
} from '../agicash-db/database';
import { getDefaultUnit } from '../shared/currencies';
import { useEncryption } from '../shared/encryption';
import type {
  CompletedCashuLightningSendTransactionDetails,
  DestinationDetails,
  IncompleteCashuLightningSendTransactionDetails,
} from '../transactions/transaction';
import {
  type TransactionRepository,
  useTransactionRepository,
} from '../transactions/transaction-repository';
import type { CashuSendQuote } from './cashu-send-quote';

type Options = {
  abortSignal?: AbortSignal;
};

type Encryption = {
  encrypt: <T = unknown>(data: T) => Promise<string>;
  decrypt: <T = unknown>(data: string) => Promise<T>;
};

type CreateSendQuote = {
  /**
   * ID of the sending user.
   */
  userId: string;
  /**
   * ID of the account to send from.
   */
  accountId: string;
  /**
   * Bolt11 invoice to pay.
   */
  paymentRequest: string;
  /**
   * Expiry of the quote in ISO 8601 format.
   */
  expiresAt: string;
  /**
   * Amount requested to send.
   */
  amountRequested: Money;
  /**
   * Amount requested to send converted to milli-satoshis.
   */
  amountRequestedInMsat: number;
  /**
   * Amount that the mint will send to the receiver.
   */
  amountToReceive: Money;
  /**
   * Fee reserve for the lightning network fee.
   */
  lightningFeeReserve: Money;
  /**
   * Cashu mint fee.
   */
  cashuFee: Money;
  /**
   * Id of the melt quote.
   */
  quoteId: string;
  /**
   * ID of the keyset to use for the send.
   */
  keysetId: string;
  /**
   * Counter value for the keyset at the time the time of send.
   */
  keysetCounter: number;
  /**
   * Number of ouputs that will be used for the send change. Keyset counter will be incremented by this number.
   */
  numberOfChangeOutputs: number;
  /**
   * Proofs to melt for the send.
   */
  proofsToSend: Proof[];
  /**
   * Version of the account as seen by the client. Used for optimistic concurrency control.
   */
  accountVersion: number;
  /**
   * Proofs to keep in the account after the send.
   */
  proofsToKeep: Proof[];
  /**
   * Destination details of the send. This will be undefined if the send is directly paying a bolt11.
   */
  destinationDetails?: DestinationDetails;
};

export class CashuSendQuoteRepository {
  constructor(
    private readonly db: AgicashDb,
    private readonly encryption: Encryption,
    private readonly transactionRepository: TransactionRepository,
  ) {}

  /**
   * Creates a cashu send.
   * @returns Created cashu send.
   */
  async create(
    {
      userId,
      accountId,
      paymentRequest,
      expiresAt,
      amountRequested,
      amountRequestedInMsat,
      amountToReceive,
      lightningFeeReserve,
      cashuFee,
      quoteId,
      keysetId,
      keysetCounter,
      numberOfChangeOutputs,
      proofsToSend,
      accountVersion,
      proofsToKeep,
      destinationDetails,
    }: CreateSendQuote,
    options?: Options,
  ): Promise<CashuSendQuote> {
    const unit = getDefaultUnit(amountToReceive.currency);

    const details: IncompleteCashuLightningSendTransactionDetails = {
      amountToReceive,
      cashuSendFee: cashuFee,
      lightningFeeReserve,
      amountReserved: new Money({
        amount: sumProofs(proofsToSend),
        currency: amountToReceive.currency,
        unit,
      }),
      paymentRequest,
      destinationDetails,
    };

    const [
      encryptedProofsToSend,
      encryptedProofsToKeep,
      encryptedTransactionDetails,
    ] = await Promise.all([
      this.encryption.encrypt(proofsToSend),
      this.encryption.encrypt(proofsToKeep),
      this.encryption.encrypt(details),
    ]);

    const query = this.db.rpc('create_cashu_send_quote', {
      p_user_id: userId,
      p_account_id: accountId,
      p_currency: amountToReceive.currency,
      p_unit: unit,
      p_payment_request: paymentRequest,
      p_expires_at: expiresAt,
      p_amount_requested: amountRequested.toNumber(unit),
      p_currency_requested: amountRequested.currency,
      p_amount_requested_in_msat: amountRequestedInMsat,
      p_amount_to_receive: amountToReceive.toNumber(unit),
      p_lightning_fee_reserve: lightningFeeReserve.toNumber(unit),
      p_cashu_fee: cashuFee.toNumber(unit),
      p_quote_id: quoteId,
      p_keyset_id: keysetId,
      p_keyset_counter: keysetCounter,
      p_number_of_change_outputs: numberOfChangeOutputs,
      p_proofs_to_send: encryptedProofsToSend,
      p_account_version: accountVersion,
      p_proofs_to_keep: encryptedProofsToKeep,
      p_encrypted_transaction_details: encryptedTransactionDetails,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to create cashu send quote', {
        cause: error,
      });
    }

    return CashuSendQuoteRepository.toSend(
      data.created_quote,
      this.encryption.decrypt,
    );
  }

  /**
   * Completes the cashu send.
   */
  async complete(
    {
      quote,
      paymentPreimage,
      amountSpent,
      accountProofs,
      accountVersion,
    }: {
      /**
       * The cashu send quote to complete.
       */
      quote: CashuSendQuote;
      /**
       * Preimage of the lightning payment.
       */
      paymentPreimage: string;
      /**
       * Amount spent on the send.
       */
      amountSpent: Money;
      /**
       * Account proofs after the send.
       */
      accountProofs: Proof[];
      /**
       * Version of the account as seen by the client. Used for optimistic concurrency control.
       */
      accountVersion: number;
    },
    options?: Options,
  ): Promise<CashuSendQuote> {
    const actualLightningFee = amountSpent
      .subtract(quote.amountToReceive)
      .subtract(quote.cashuFee);

    const totalFees = actualLightningFee.add(quote.cashuFee);

    const transaction = await this.transactionRepository.get(
      quote.transactionId,
    );

    if (
      !transaction ||
      transaction.type !== 'CASHU_LIGHTNING' ||
      transaction.direction !== 'SEND' ||
      transaction.state !== 'PENDING'
    ) {
      throw new Error(`Transaction not found for quote ${quote.id}.`);
    }

    const updatedTransactionDetails: CompletedCashuLightningSendTransactionDetails =
      {
        ...transaction.details,
        preimage: paymentPreimage,
        amountSpent,
        lightningFee: actualLightningFee,
        totalFees,
      };

    const [encryptedAccountProofs, encryptedUpdatedTransactionDetails] =
      await Promise.all([
        this.encryption.encrypt(accountProofs),
        this.encryption.encrypt(updatedTransactionDetails),
      ]);

    const query = this.db.rpc('complete_cashu_send_quote', {
      p_quote_id: quote.id,
      p_payment_preimage: paymentPreimage,
      p_amount_spent: amountSpent.toNumber(
        getDefaultUnit(amountSpent.currency),
      ),
      p_quote_version: quote.version,
      p_account_proofs: encryptedAccountProofs,
      p_account_version: accountVersion,
      p_encrypted_transaction_details: encryptedUpdatedTransactionDetails,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to complete cashu send quote', {
        cause: error,
      });
    }

    return CashuSendQuoteRepository.toSend(
      data.updated_quote,
      this.encryption.decrypt,
    );
  }

  /**
   * Expires the cashu send quote by setting the state to EXPIRED. It also returns the proofs that were reserved for the send back to the account.
   */
  async expire(
    {
      id,
      version,
      accountProofs,
      accountVersion,
    }: {
      /**
       * ID of the cashu send quote.
       */
      id: string;
      /**
       * Version of the cashu send quote as seen by the client. Used for optimistic concurrency control.
       */
      version: number;
      /**
       * Account proofs to set.
       */
      accountProofs: Proof[];
      /**
       * Version of the account as seen by the client. Used for optimistic concurrency control.
       */
      accountVersion: number;
    },
    options?: Options,
  ): Promise<void> {
    const encryptedAccountProofs = await this.encryption.encrypt(accountProofs);

    const query = this.db.rpc('expire_cashu_send_quote', {
      p_quote_id: id,
      p_quote_version: version,
      p_account_proofs: encryptedAccountProofs,
      p_account_version: accountVersion,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { error } = await query;

    if (error) {
      throw new Error('Failed to expire cashu send quote', { cause: error });
    }
  }

  /**
   * Fails the cashu send quote by setting the state to FAILED. It also returns the proofs that were reserved for the send back to the account.
   */
  async fail(
    {
      id,
      reason,
      version,
      accountProofs,
      accountVersion,
    }: {
      /**
       * ID of the cashu send quote.
       */
      id: string;
      /**
       * Reason for the failure.
       */
      reason: string;
      /**
       * Version of the cashu send quote as seen by the client. Used for optimistic concurrency control.
       */
      version: number;
      /**
       * Account proofs to set.
       */
      accountProofs: Proof[];
      /**
       * Version of the account as seen by the client. Used for optimistic concurrency control.
       */
      accountVersion: number;
    },
    options?: Options,
  ): Promise<void> {
    const encryptedAccountProofs = await this.encryption.encrypt(accountProofs);

    const query = this.db.rpc('fail_cashu_send_quote', {
      p_quote_id: id,
      p_failure_reason: reason,
      p_quote_version: version,
      p_account_proofs: encryptedAccountProofs,
      p_account_version: accountVersion,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { error } = await query;

    if (error) {
      throw new Error('Failed to fail cashu send quote', { cause: error });
    }
  }

  async markAsPending(
    {
      id,
      version,
    }: {
      /**
       * ID of the cashu send quote.
       */
      id: string;
      /**
       * Version of the cashu send quote as seen by the client. Used for optimistic concurrency control.
       */
      version: number;
    },
    options?: Options,
  ): Promise<CashuSendQuote> {
    const query = this.db
      .from('cashu_send_quotes')
      .update({ state: 'PENDING', version: version + 1 })
      .match({ id, version })
      .select();

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to mark cashu send as pending', { cause: error });
    }

    if (!data) {
      throw new Error(
        `Concurrency error: Cashu send quote ${id} was modified by another transaction. Expected version ${version}, but found different one.`,
      );
    }

    return CashuSendQuoteRepository.toSend(data, this.encryption.decrypt);
  }

  /**
   * Gets the cashu send quote with the given id.
   * @param id - The id of the cashu send quote to get.
   * @returns The cashu send quote.
   */
  async get(id: string, options?: Options): Promise<CashuSendQuote | null> {
    const query = this.db.from('cashu_send_quotes').select().eq('id', id);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to get cashu send', { cause: error });
    }

    return data
      ? CashuSendQuoteRepository.toSend(data, this.encryption.decrypt)
      : null;
  }

  async getByTransactionId(
    transactionId: string,
    options?: Options,
  ): Promise<CashuSendQuote | null> {
    const query = this.db
      .from('cashu_send_quotes')
      .select()
      .eq('transaction_id', transactionId);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to get cashu send quote by transaction id', {
        cause: error,
      });
    }

    return data
      ? CashuSendQuoteRepository.toSend(data, this.encryption.decrypt)
      : null;
  }

  /**
   * Gets all unresolved (UNPAID or PENDING) cashu send quotes for the given user.
   * @param userId - The id of the user to get the cashu send quotes for.
   * @returns Unresolved cashu send quotes.
   */
  async getUnresolved(
    userId: string,
    options?: Options,
  ): Promise<CashuSendQuote[]> {
    const query = this.db
      .from('cashu_send_quotes')
      .select()
      .eq('user_id', userId)
      .in('state', ['UNPAID', 'PENDING']);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to get pending cashu send quotes', {
        cause: error,
      });
    }

    return await Promise.all(
      data.map(
        async (data) =>
          await CashuSendQuoteRepository.toSend(data, this.encryption.decrypt),
      ),
    );
  }

  static async toSend(
    data: AgicashDbCashuSendQuote,
    decryptData: Encryption['decrypt'],
  ): Promise<CashuSendQuote> {
    const decryptedData = {
      ...data,
      proofs: await decryptData<Proof[]>(data.proofs),
    };

    const commonData = {
      id: decryptedData.id,
      createdAt: decryptedData.created_at,
      expiresAt: decryptedData.expires_at,
      userId: decryptedData.user_id,
      accountId: decryptedData.account_id,
      paymentRequest: decryptedData.payment_request,
      amountRequested: new Money({
        amount: decryptedData.amount_requested,
        currency: decryptedData.currency_requested,
        unit: decryptedData.unit,
      }),
      amountRequestedInMsat: decryptedData.amount_requested_in_msat,
      amountToReceive: new Money({
        amount: decryptedData.amount_to_receive,
        currency: decryptedData.currency,
        unit: decryptedData.unit,
      }),
      lightningFeeReserve: new Money({
        amount: decryptedData.lightning_fee_reserve,
        currency: decryptedData.currency,
        unit: decryptedData.unit,
      }),
      cashuFee: new Money({
        amount: decryptedData.cashu_fee,
        currency: decryptedData.currency,
        unit: decryptedData.unit,
      }),
      quoteId: decryptedData.quote_id,
      proofs: decryptedData.proofs,
      keysetId: decryptedData.keyset_id,
      keysetCounter: decryptedData.keyset_counter,
      numberOfChangeOutputs: decryptedData.number_of_change_outputs,
      version: decryptedData.version,
      transactionId: decryptedData.transaction_id,
    };

    if (decryptedData.state === 'PAID') {
      return {
        ...commonData,
        state: 'PAID',
        paymentPreimage: decryptedData.payment_preimage ?? '',
        amountSpent: new Money({
          amount: decryptedData.amount_spent ?? 0,
          currency: decryptedData.currency,
          unit: decryptedData.unit,
        }),
      };
    }

    if (decryptedData.state === 'FAILED') {
      return {
        ...commonData,
        state: 'FAILED',
        failureReason: decryptedData.failure_reason ?? '',
      };
    }

    if (
      decryptedData.state === 'UNPAID' ||
      decryptedData.state === 'PENDING' ||
      decryptedData.state === 'EXPIRED'
    ) {
      return {
        ...commonData,
        state: decryptedData.state,
      };
    }

    throw new Error(`Unexpected quote state ${decryptedData.state}`);
  }
}

export function useCashuSendQuoteRepository() {
  const encryption = useEncryption();
  const transactionRepository = useTransactionRepository();
  return new CashuSendQuoteRepository(
    agicashDb,
    encryption,
    transactionRepository,
  );
}
