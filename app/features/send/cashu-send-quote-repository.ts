import type { Proof } from '@cashu/cashu-ts';
import type { Json } from 'supabase/database.types';
import { proofToY, sumProofs } from '~/lib/cashu';
import { Money } from '~/lib/money';
import { computeSHA256 } from '~/lib/sha256';
import type { CashuProof } from '../accounts/account';
import type {
  AgicashDb,
  AgicashDbCashuProof,
  AgicashDbCashuSendQuote,
} from '../agicash-db/database';
import { agicashDbClient } from '../agicash-db/database.client';
import { getDefaultUnit } from '../shared/currencies';
import { type Encryption, useEncryption } from '../shared/encryption';
import { ConcurrencyError } from '../shared/error';
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

type EncryptedData = {
  paymentRequest: string;
  amountRequested: number;
  amountRequestedInMsat: number;
  amountToReceive: number;
  lightningFeeReserve: number;
  cashuFee: number;
  quoteId: string;
  amountSpent?: number;
  paymentPreimage?: string;
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
   * Payment hash of the lightning invoice.
   */
  paymentHash: string;
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
   * Number of ouputs that will be used for the send change. Keyset counter will be incremented by this number.
   */
  numberOfChangeOutputs: number;
  /**
   * Proofs to melt for the send.
   */
  proofsToSend: CashuProof[];
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
      paymentHash,
      expiresAt,
      amountRequested,
      amountRequestedInMsat,
      amountToReceive,
      lightningFeeReserve,
      cashuFee,
      quoteId,
      keysetId,
      numberOfChangeOutputs,
      proofsToSend,
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

    const dataToEncrypt: EncryptedData = {
      paymentRequest,
      amountRequested: amountRequested.toNumber(unit),
      amountRequestedInMsat,
      amountToReceive: amountToReceive.toNumber(unit),
      lightningFeeReserve: lightningFeeReserve.toNumber(unit),
      cashuFee: cashuFee.toNumber(unit),
      quoteId,
    };

    const [[encryptedTransactionDetails, encryptedData], quoteIdHash] =
      await Promise.all([
        this.encryption.encryptBatch([details, dataToEncrypt]),
        computeSHA256(quoteId),
      ]);

    const query = this.db.rpc('create_cashu_send_quote', {
      p_user_id: userId,
      p_account_id: accountId,
      p_currency: amountToReceive.currency,
      p_unit: unit,
      p_currency_requested: amountRequested.currency,
      p_expires_at: expiresAt,
      p_keyset_id: keysetId,
      p_number_of_change_outputs: numberOfChangeOutputs,
      p_proofs_to_send: proofsToSend.map((p) => p.id),
      p_encrypted_data: encryptedData,
      p_encrypted_transaction_details: encryptedTransactionDetails,
      p_quote_id_hash: quoteIdHash,
      p_payment_hash: paymentHash,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      if (error.hint === 'CONCURRENCY_ERROR') {
        throw new ConcurrencyError(error.message, error.details);
      }

      throw new Error('Failed to create cashu send quote', {
        cause: error,
      });
    }

    return await this.toSendQuote({
      ...data.quote,
      cashu_proofs: data.reserved_proofs,
    });
  }

  /**
   * Completes the cashu send.
   */
  async complete(
    {
      quote,
      paymentPreimage,
      amountSpent,
      changeProofs,
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
       * Change proofs to add back to the account.
       */
      changeProofs: Proof[];
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

    const proofDataToEncrypt = changeProofs.flatMap((x) => [
      x.amount,
      x.secret,
    ]);

    const unit = getDefaultUnit(amountSpent.currency);

    const dataToEncrypt: EncryptedData = {
      paymentRequest: quote.paymentRequest,
      amountRequested: quote.amountRequested.toNumber(unit),
      amountRequestedInMsat: quote.amountRequestedInMsat,
      amountToReceive: quote.amountToReceive.toNumber(unit),
      lightningFeeReserve: quote.lightningFeeReserve.toNumber(unit),
      cashuFee: quote.cashuFee.toNumber(unit),
      quoteId: quote.quoteId,
      amountSpent: amountSpent.toNumber(unit),
      paymentPreimage,
    };

    const [
      encryptedData,
      encryptedUpdatedTransactionDetails,
      ...encryptedProofData
    ] = await this.encryption.encryptBatch([
      dataToEncrypt,
      updatedTransactionDetails,
      ...proofDataToEncrypt,
    ]);

    const encryptedProofs = changeProofs.map((x, index) => {
      const encryptedDataIndex = index * 2;
      return {
        keysetId: x.id,
        amount: encryptedProofData[encryptedDataIndex],
        secret: encryptedProofData[encryptedDataIndex + 1],
        unblindedSignature: x.C,
        publicKeyY: proofToY(x),
        dleq: x.dleq as Json,
        witness: x.witness as Json,
      };
    });

    const query = this.db.rpc('complete_cashu_send_quote', {
      p_quote_id: quote.id,
      p_change_proofs: encryptedProofs,
      p_encrypted_data: encryptedData,
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

    return this.toSendQuote({ ...data.quote, cashu_proofs: data.spent_proofs });
  }

  /**
   * Expires the cashu send quote by setting the state to EXPIRED. It also returns the proofs that were reserved for the send back to the account.
   * @param id - The id of the cashu send quote to expire.
   */
  async expire(id: string, options?: Options): Promise<void> {
    const query = this.db.rpc('expire_cashu_send_quote', {
      p_quote_id: id,
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
   * Fails the cashu send quote by setting the state to FAILED.
   * @returns The updated cashu send quote.
   * @throws An error if failing the cashu send quote fails.
   */
  async fail(
    {
      id,
      reason,
    }: {
      /**
       * ID of the cashu send quote.
       */
      id: string;
      /**
       * Reason for the failure.
       */
      reason: string;
    },
    options?: Options,
  ): Promise<CashuSendQuote> {
    const query = this.db.rpc('fail_cashu_send_quote', {
      p_quote_id: id,
      p_failure_reason: reason,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to fail cashu send quote', { cause: error });
    }

    return this.toSendQuote({
      ...data.quote,
      cashu_proofs: data.released_proofs,
    });
  }

  /**
   * Marks the cashu send quote as pending.
   * @param id - The id of the cashu send quote to mark as pending.
   * @returns The updated cashu send quote.
   * @throws An error if marking the cashu send quote as pending fails.
   */
  async markAsPending(id: string, options?: Options): Promise<CashuSendQuote> {
    const query = this.db.rpc('mark_cashu_send_quote_as_pending', {
      p_quote_id: id,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to mark cashu send as pending', { cause: error });
    }

    return this.toSendQuote({ ...data.quote, cashu_proofs: data.proofs });
  }

  /**
   * Gets the cashu send quote with the given id.
   * @param id - The id of the cashu send quote to get.
   * @returns The cashu send quote.
   */
  async get(id: string, options?: Options): Promise<CashuSendQuote | null> {
    const query = this.db
      .from('cashu_send_quotes')
      .select('*, cashu_proofs!spending_cashu_send_quote_id(*)')
      .eq('id', id);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to get cashu send', { cause: error });
    }

    return data ? this.toSendQuote(data) : null;
  }

  /**
   * Gets the cashu send quote with the given transaction id.
   * @param transactionId - The id of the transaction to get the cashu send quote for.
   * @returns The cashu send quote.
   */
  async getByTransactionId(
    transactionId: string,
    options?: Options,
  ): Promise<CashuSendQuote | null> {
    const query = this.db
      .from('cashu_send_quotes')
      .select('*, cashu_proofs!spending_cashu_send_quote_id(*)')
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

    return data ? this.toSendQuote(data) : null;
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
      .select('*, cashu_proofs!spending_cashu_send_quote_id(*)')
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

    return await Promise.all(data.map((x) => this.toSendQuote(x)));
  }

  async toSendQuote(
    data: AgicashDbCashuSendQuote & { cashu_proofs: AgicashDbCashuProof[] },
  ): Promise<CashuSendQuote> {
    const [encryptedData] = await this.encryption.decryptBatch<[EncryptedData]>(
      [data.encrypted_data],
    );

    const proofs = await this.decryptCashuProofs(data.cashu_proofs);

    const commonData = {
      id: data.id,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      userId: data.user_id,
      accountId: data.account_id,
      paymentRequest: encryptedData.paymentRequest,
      paymentHash: data.payment_hash,
      amountRequested: new Money({
        amount: encryptedData.amountRequested,
        currency: data.currency_requested,
        unit: data.unit,
      }),
      amountRequestedInMsat: encryptedData.amountRequestedInMsat,
      amountToReceive: new Money({
        amount: encryptedData.amountToReceive,
        currency: data.currency,
        unit: data.unit,
      }),
      lightningFeeReserve: new Money({
        amount: encryptedData.lightningFeeReserve,
        currency: data.currency,
        unit: data.unit,
      }),
      cashuFee: new Money({
        amount: encryptedData.cashuFee,
        currency: data.currency,
        unit: data.unit,
      }),
      proofs,
      quoteId: encryptedData.quoteId,
      keysetId: data.keyset_id,
      keysetCounter: data.keyset_counter,
      numberOfChangeOutputs: data.number_of_change_outputs,
      version: data.version,
      transactionId: data.transaction_id,
    };

    if (data.state === 'PAID') {
      return {
        ...commonData,
        state: 'PAID',
        paymentPreimage: encryptedData.paymentPreimage ?? '',
        amountSpent: new Money({
          amount: encryptedData.amountSpent ?? 0,
          currency: data.currency,
          unit: data.unit,
        }),
      };
    }

    if (data.state === 'FAILED') {
      return {
        ...commonData,
        state: 'FAILED',
        failureReason: data.failure_reason ?? '',
      };
    }

    if (
      data.state === 'UNPAID' ||
      data.state === 'PENDING' ||
      data.state === 'EXPIRED'
    ) {
      return {
        ...commonData,
        state: data.state,
      };
    }

    throw new Error(`Unexpected quote state ${data.state}`);
  }

  private async decryptCashuProofs(
    proofs: AgicashDbCashuProof[],
  ): Promise<CashuProof[]> {
    const encryptedData = proofs.flatMap((x) => [x.amount, x.secret]);
    const decryptedData = await this.encryption.decryptBatch(encryptedData);

    return proofs.map((dbProof, index) => {
      const decryptedDataIndex = index * 2;
      const amount = decryptedData[decryptedDataIndex] as number;
      const secret = decryptedData[decryptedDataIndex + 1] as string;
      return {
        id: dbProof.id,
        accountId: dbProof.account_id,
        userId: dbProof.user_id,
        keysetId: dbProof.keyset_id,
        amount,
        secret,
        unblindedSignature: dbProof.unblinded_signature,
        publicKeyY: dbProof.public_key_y,
        dleq: dbProof.dleq as Proof['dleq'],
        witness: dbProof.witness as Proof['witness'],
        state: dbProof.state as CashuProof['state'],
        version: dbProof.version,
        createdAt: dbProof.created_at,
        reservedAt: dbProof.reserved_at,
      };
    });
  }
}

export function useCashuSendQuoteRepository() {
  const encryption = useEncryption();
  const transactionRepository = useTransactionRepository();
  return new CashuSendQuoteRepository(
    agicashDbClient,
    encryption,
    transactionRepository,
  );
}
