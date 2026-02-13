import type { Proof } from '@cashu/cashu-ts';
import type { z } from 'zod';
import { proofToY } from '~/lib/cashu';
import type { Money } from '~/lib/money';
import { computeSHA256 } from '~/lib/sha256';
import type { AllUnionFieldsRequired } from '~/lib/type-utils';
import type { CashuProof } from '../accounts/cashu-account';
import type {
  AgicashDb,
  AgicashDbCashuProof,
  AgicashDbCashuSendQuote,
} from '../agicash-db/database';
import { agicashDbClient } from '../agicash-db/database.client';
import { CashuLightningSendDbDataSchema } from '../agicash-db/json-models';
import { type Encryption, useEncryption } from '../shared/encryption';
import { ConcurrencyError } from '../shared/error';
import {
  type CashuSendQuote,
  CashuSendQuoteSchema,
  type DestinationDetails,
} from './cashu-send-quote';
import { toDecryptedCashuProofs } from './utils';

type Options = {
  abortSignal?: AbortSignal;
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
   * Amount of the proofs reserved for the send in the account's currency.
   */
  amountReserved: Money;
  /**
   * Destination details of the send. This will be undefined if the send is directly paying a bolt11.
   */
  destinationDetails?: DestinationDetails;
};

export class CashuSendQuoteRepository {
  constructor(
    private readonly db: AgicashDb,
    private readonly encryption: Encryption,
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
      amountReserved,
      destinationDetails,
    }: CreateSendQuote,
    options?: Options,
  ): Promise<CashuSendQuote> {
    const sendData = CashuLightningSendDbDataSchema.parse({
      paymentRequest,
      amountRequested,
      amountRequestedInMsat,
      amountReceived: amountToReceive,
      lightningFeeReserve,
      cashuSendFee: cashuFee,
      meltQuoteId: quoteId,
      amountReserved,
      destinationDetails,
    } satisfies z.input<typeof CashuLightningSendDbDataSchema>);

    const [encryptedData, quoteIdHash] = await Promise.all([
      this.encryption.encrypt(sendData),
      computeSHA256(quoteId),
    ]);

    const query = this.db.rpc('create_cashu_send_quote', {
      p_user_id: userId,
      p_account_id: accountId,
      p_currency: amountToReceive.currency,
      p_currency_requested: amountRequested.currency,
      p_expires_at: expiresAt,
      p_keyset_id: keysetId,
      p_number_of_change_outputs: numberOfChangeOutputs,
      p_proofs_to_send: proofsToSend.map((p) => p.id),
      p_encrypted_data: encryptedData,
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

    return await this.toQuote({
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
      .subtract(quote.amountReceived)
      .subtract(quote.cashuFee);

    const totalFee = actualLightningFee.add(quote.cashuFee);

    const sendData = CashuLightningSendDbDataSchema.parse({
      paymentRequest: quote.paymentRequest,
      amountRequested: quote.amountRequested,
      amountRequestedInMsat: quote.amountRequestedInMsat,
      amountReceived: quote.amountReceived,
      lightningFeeReserve: quote.lightningFeeReserve,
      cashuSendFee: quote.cashuFee,
      meltQuoteId: quote.quoteId,
      amountReserved: quote.amountReserved,
      destinationDetails: quote.destinationDetails,
      amountSpent,
      paymentPreimage,
      lightningFee: actualLightningFee,
      totalFee,
    } satisfies z.input<typeof CashuLightningSendDbDataSchema>);

    const proofDataToEncrypt = changeProofs.flatMap((x) => [
      x.amount,
      x.secret,
    ]);

    const [encryptedData, ...encryptedProofData] =
      await this.encryption.encryptBatch([sendData, ...proofDataToEncrypt]);

    const encryptedProofs = changeProofs.map((x, index) => {
      const encryptedDataIndex = index * 2;
      return {
        keysetId: x.id,
        amount: encryptedProofData[encryptedDataIndex],
        secret: encryptedProofData[encryptedDataIndex + 1],
        unblindedSignature: x.C,
        publicKeyY: proofToY(x),
        dleq: x.dleq ?? null,
        witness: x.witness ?? null,
      };
    });

    const query = this.db.rpc('complete_cashu_send_quote', {
      p_quote_id: quote.id,
      p_change_proofs: encryptedProofs,
      p_encrypted_data: encryptedData,
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

    return this.toQuote({ ...data.quote, cashu_proofs: data.spent_proofs });
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

    return this.toQuote({
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

    return this.toQuote({ ...data.quote, cashu_proofs: data.proofs });
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

    return data ? this.toQuote(data) : null;
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

    return data ? this.toQuote(data) : null;
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

    return await Promise.all(data.map((x) => this.toQuote(x)));
  }

  async toQuote(
    data: AgicashDbCashuSendQuote & { cashu_proofs: AgicashDbCashuProof[] },
  ): Promise<CashuSendQuote> {
    const proofsDataToDecrypt = data.cashu_proofs.flatMap((x) => [
      x.amount,
      x.secret,
    ]);

    const [decryptedData, ...decryptedProofs] =
      await this.encryption.decryptBatch([
        data.encrypted_data,
        ...proofsDataToDecrypt,
      ]);
    const proofs = toDecryptedCashuProofs(data.cashu_proofs, decryptedProofs);

    const sendData = CashuLightningSendDbDataSchema.parse(decryptedData);

    // `satisfies AllUnionFieldsRequired` gives compile time safety and makes sure that all fields are present and of the correct type.
    // schema parse then is doing cashu send quote invariant check at runtime. For example it makes sure that paymentPreimage is present when state is PAID, etc.
    return CashuSendQuoteSchema.parse({
      id: data.id,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      userId: data.user_id,
      accountId: data.account_id,
      paymentRequest: sendData.paymentRequest,
      paymentHash: data.payment_hash,
      amountRequested: sendData.amountRequested,
      amountRequestedInMsat: sendData.amountRequestedInMsat,
      amountReceived: sendData.amountReceived,
      amountReserved: sendData.amountReserved,
      lightningFeeReserve: sendData.lightningFeeReserve,
      cashuFee: sendData.cashuSendFee,
      proofs,
      quoteId: sendData.meltQuoteId,
      destinationDetails: sendData.destinationDetails,
      keysetId: data.keyset_id,
      keysetCounter: data.keyset_counter,
      numberOfChangeOutputs: data.number_of_change_outputs,
      version: data.version,
      transactionId: data.transaction_id,
      state: data.state,
      failureReason: data.failure_reason ?? undefined,
      paymentPreimage: sendData.paymentPreimage,
      amountSpent: sendData.amountSpent,
      lightningFee: sendData.lightningFee,
      totalFee: sendData.totalFee,
    } satisfies AllUnionFieldsRequired<z.output<typeof CashuSendQuoteSchema>>);
  }
}

export function useCashuSendQuoteRepository() {
  const encryption = useEncryption();
  return new CashuSendQuoteRepository(agicashDbClient, encryption);
}
