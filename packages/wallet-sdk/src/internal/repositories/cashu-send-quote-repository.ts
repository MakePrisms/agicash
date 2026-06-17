import type { Money } from '@agicash/money';
import { Money as MoneyClass } from '@agicash/money';
import type { Proof } from '@cashu/cashu-ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod/mini';
import { ConcurrencyError, DomainError } from '../../errors';
import type { CashuProof } from '../../types/account';
import type { CashuSendQuote } from '../../types/cashu';
import type { TransactionPurpose } from '../../types/transaction';
import { classify } from '../classify';
import type { EncryptionService } from '../crypto/encryption';
import { sha256Hex } from '../crypto/sha256';
import { toDecryptedCashuProofs, toEncryptedProofData } from '../db/cashu-proofs';
import {
  CashuLightningSendDbDataSchema,
  DestinationDetailsSchema,
} from '../db/cashu-send-quote-db-data';
import type {
  AgicashDbCashuProof,
  AgicashDbCashuSendQuote,
  Database,
} from '../db/database';

// ---------------------------------------------------------------------------
// CashuSendQuoteSchema — ported from app/features/send/cashu-send-quote.ts.
// DestinationDetailsSchema is reused from cashu-send-quote-db-data (one copy).
// ---------------------------------------------------------------------------

const CashuSendQuoteBaseSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  userId: z.string(),
  accountId: z.string(),
  paymentRequest: z.string(),
  paymentHash: z.string(),
  amountRequested: z.instanceof(MoneyClass),
  amountRequestedInMsat: z.number(),
  amountReceived: z.instanceof(MoneyClass),
  lightningFeeReserve: z.instanceof(MoneyClass),
  cashuFee: z.instanceof(MoneyClass),
  quoteId: z.string(),
  proofs: z.array(z.custom<CashuProof>()),
  amountReserved: z.instanceof(MoneyClass),
  destinationDetails: z.optional(DestinationDetailsSchema),
  keysetId: z.string(),
  keysetCounter: z.number(),
  numberOfChangeOutputs: z.number(),
  transactionId: z.string(),
  version: z.number(),
});

const CashuSendQuoteSchema = z.intersection(
  CashuSendQuoteBaseSchema,
  z.union([
    z.object({ state: z.literal('UNPAID') }),
    z.object({ state: z.literal('PENDING') }),
    z.object({ state: z.literal('EXPIRED') }),
    z.object({ state: z.literal('FAILED'), failureReason: z.string() }),
    z.object({
      state: z.literal('PAID'),
      paymentPreimage: z.string(),
      lightningFee: z.instanceof(MoneyClass),
      amountSpent: z.instanceof(MoneyClass),
      totalFee: z.instanceof(MoneyClass),
    }),
  ]),
);

// Compile-time check: schema output must be assignable to the contract type.
type _SchemaFitsContract = z.infer<
  typeof CashuSendQuoteSchema
> extends CashuSendQuote
  ? true
  : never;
const _check: _SchemaFitsContract = true;
void _check;

// ---------------------------------------------------------------------------
// Public input type + repository
// ---------------------------------------------------------------------------

type DestinationDetails = z.infer<typeof DestinationDetailsSchema>;

type Options = { abortSignal?: AbortSignal };

export type CreateSendQuote = {
  /** ID of the sending user. */
  userId: string;
  /** ID of the account to send from. */
  accountId: string;
  /** Bolt11 invoice to pay. */
  paymentRequest: string;
  /** Payment hash of the lightning invoice. */
  paymentHash: string;
  /** Expiry of the quote in ISO 8601 format. */
  expiresAt: string;
  /** Amount requested to send. */
  amountRequested: Money;
  /** Amount requested to send converted to milli-satoshis. */
  amountRequestedInMsat: number;
  /** Amount that the mint will send to the receiver. */
  amountToReceive: Money;
  /** Fee reserve for the lightning network fee. */
  lightningFeeReserve: Money;
  /** Cashu mint fee. */
  cashuFee: Money;
  /** Id of the melt quote. */
  quoteId: string;
  /** ID of the keyset to use for the send. */
  keysetId: string;
  /** Number of outputs that will be used for the send change. */
  numberOfChangeOutputs: number;
  /** Proofs to melt for the send. */
  proofsToSend: CashuProof[];
  /** Amount of the proofs reserved for the send in the account's currency. */
  amountReserved: Money;
  /** Destination details of the send. Undefined if paying a bolt11 directly. */
  destinationDetails?: DestinationDetails;
  /** The purpose of this transaction. */
  purpose?: TransactionPurpose;
  /** UUID linking paired send/receive transactions in a transfer. */
  transferId?: string;
};

/** Data access for `wallet.cashu_send_quotes` (+ `cashu_proofs`). */
export class CashuSendQuoteRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Creates a cashu send quote.
   * @returns Created cashu send quote.
   * @throws {DomainError} code `limit_reached` when the user has hit the send quote limit.
   * @throws {ConcurrencyError} on optimistic-lock conflicts.
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
      purpose,
      transferId,
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
    });

    const encryption = await this.encryption.get();
    const [encryptedData, quoteIdHash] = await Promise.all([
      encryption.encrypt(sendData),
      sha256Hex(quoteId),
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
      p_purpose: purpose,
      p_transfer_id: transferId,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      if (error.hint === 'LIMIT_REACHED') {
        throw new DomainError(
          `${error.message} ${error.details}`,
          'limit_reached',
        );
      }
      if (error.hint === 'CONCURRENCY_ERROR') {
        throw new ConcurrencyError(
          error.message,
          error.details ?? 'concurrency',
        );
      }
      throw classify(error);
    }

    return this.toQuote({
      ...data.quote,
      cashu_proofs: data.reserved_proofs,
    });
  }

  /**
   * Completes the cashu send quote (state → PAID).
   * @throws if the RPC fails.
   */
  async complete(
    {
      quote,
      paymentPreimage,
      amountSpent,
      changeProofs,
    }: {
      quote: CashuSendQuote;
      paymentPreimage: string;
      amountSpent: Money;
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
    });

    const encryption = await this.encryption.get();
    const [encryptedData, encryptedProofs] = await Promise.all([
      encryption.encrypt(sendData),
      toEncryptedProofData(changeProofs, encryption),
    ]);

    const query = this.db.rpc('complete_cashu_send_quote', {
      p_quote_id: quote.id,
      p_change_proofs: encryptedProofs,
      p_encrypted_data: encryptedData as string,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw classify(error);
    }

    return this.toQuote({ ...data.quote, cashu_proofs: data.spent_proofs });
  }

  /**
   * Expires the cashu send quote (state → EXPIRED) and releases reserved proofs.
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
      throw classify(error);
    }
  }

  /**
   * Fails the cashu send quote (state → FAILED).
   * @returns The updated cashu send quote.
   */
  async fail(
    { id, reason }: { id: string; reason: string },
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
      throw classify(error);
    }

    return this.toQuote({
      ...data.quote,
      cashu_proofs: data.released_proofs,
    });
  }

  /**
   * Marks the cashu send quote as pending (state → PENDING).
   * @param id - The id of the cashu send quote to mark as pending.
   * @returns The updated cashu send quote.
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
      throw classify(error);
    }

    return this.toQuote({ ...data.quote, cashu_proofs: data.proofs });
  }

  /**
   * Gets the cashu send quote with the given id.
   * @returns The cashu send quote, or null if not found.
   */
  async get(id: string, options?: Options): Promise<CashuSendQuote | null> {
    const q = this.db
      .from('cashu_send_quotes')
      .select('*, cashu_proofs!spending_cashu_send_quote_id(*)')
      .eq('id', id);
    if (options?.abortSignal) q.abortSignal(options.abortSignal);

    const { data, error } = await q.maybeSingle();

    if (error) {
      throw classify(error);
    }

    return data ? this.toQuote(data) : null;
  }

  /**
   * Gets the cashu send quote with the given transaction id.
   * @returns The cashu send quote, or null if not found.
   */
  async getByTransactionId(
    transactionId: string,
    options?: Options,
  ): Promise<CashuSendQuote | null> {
    const q = this.db
      .from('cashu_send_quotes')
      .select('*, cashu_proofs!spending_cashu_send_quote_id(*)')
      .eq('transaction_id', transactionId);
    if (options?.abortSignal) q.abortSignal(options.abortSignal);

    const { data, error } = await q.maybeSingle();

    if (error) {
      throw classify(error);
    }

    return data ? this.toQuote(data) : null;
  }

  /**
   * Gets all unresolved (UNPAID or PENDING) cashu send quotes for the given user.
   * @returns Unresolved cashu send quotes.
   */
  async getUnresolved(
    userId: string,
    options?: Options,
  ): Promise<CashuSendQuote[]> {
    const q = this.db
      .from('cashu_send_quotes')
      .select('*, cashu_proofs!spending_cashu_send_quote_id(*)')
      .eq('user_id', userId)
      .in('state', ['UNPAID', 'PENDING']);
    if (options?.abortSignal) q.abortSignal(options.abortSignal);

    const { data, error } = await q;

    if (error) {
      throw classify(error);
    }

    return Promise.all((data ?? []).map((x) => this.toQuote(x)));
  }

  private async toQuote(
    data:
      | (AgicashDbCashuSendQuote & { cashu_proofs: AgicashDbCashuProof[] })
      | null,
  ): Promise<CashuSendQuote> {
    if (!data) {
      throw new DomainError(
        'Expected send quote data but got null',
        'not_found',
      );
    }

    const proofsDataToDecrypt = data.cashu_proofs.flatMap((x) => [
      x.amount,
      x.secret,
    ]);

    const encryption = await this.encryption.get();
    const [decryptedData, ...decryptedProofs] = await encryption.decryptBatch([
      data.encrypted_data,
      ...proofsDataToDecrypt,
    ]);

    const proofs = toDecryptedCashuProofs(data.cashu_proofs, decryptedProofs);
    const sendData = CashuLightningSendDbDataSchema.parse(decryptedData);

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
    });
  }
}
