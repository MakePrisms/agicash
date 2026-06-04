/**
 * Internal `wallet.cashu_send_quotes` repository — Slice 3 / PR5b (cashu lightning send).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/send/cashu-send-quote-repository.ts`. Master expresses this
 * over a React-hook-constructed repo wired to the module-global `agicashDbClient` +
 * `useEncryption`; here it is a plain class over the SDK-owned Supabase client + the SDK's
 * {@link Encryption} (both injected). The RPCs (`create_cashu_send_quote` /
 * `complete_cashu_send_quote` / `mark_cashu_send_quote_as_pending` / `fail_…` / `expire_…`)
 * are unchanged — the DB reservation + CONCURRENCY_ERROR guard (the stale-proof protection)
 * lives in those stored procedures and is preserved verbatim.
 *
 * The only re-housing: the encrypted-jsonb schema (`CashuLightningSendDbDataSchema`) and the
 * domain schema (`CashuSendQuoteSchema`) come from the SDK-internal single-source re-export
 * (`./lib-cashu-quotes`); the DB-row types are the hand-written {@link AgicashDbCashuSendQuote}
 * (matching `db-account.ts`'s approach, since the generated `database.types` are not yet
 * lifted). `toQuote` maps a DB row → the public {@link CashuSendQuote}.
 *
 * @module
 */
import type { Proof } from '@cashu/cashu-ts';
import type { z } from 'zod/mini';
import type { AgicashDbCashuProof } from './db-account';
import {
  CashuLightningSendDbDataSchema,
  CashuSendQuoteSchema,
  proofToY,
  toDecryptedCashuProofs,
} from './lib-cashu-quotes';
import type { WalletSupabaseClient } from './supabase-client';
import { computeSHA256 } from './crypto';
import { ConcurrencyError } from '../errors';
import type { Encryption } from './encryption';
import type { CashuProof } from '../types/account';
import type { CashuSendQuote, DestinationDetails } from '../types/cashu';
import type { Money } from '../types/money';

/** Per-call query options (an abort signal, matching master). */
type Options = { abortSignal?: AbortSignal };

/**
 * A row of the `wallet.cashu_send_quotes` table (hand-written; master = generated
 * `database.types`). Only the columns `toQuote` reads are typed; `encrypted_data` is the
 * ciphertext jsonb the repo decrypts.
 */
export type AgicashDbCashuSendQuote = {
  id: string;
  created_at: string;
  expires_at: string;
  user_id: string;
  account_id: string;
  transaction_id: string;
  payment_hash: string;
  encrypted_data: string;
  keyset_id: string;
  keyset_counter: number;
  number_of_change_outputs: number;
  version: number;
  state: CashuSendQuote['state'];
  failure_reason?: string | null;
};

/** Params for {@link CashuSendQuoteRepository.create} (master `CreateSendQuote`). */
export type CreateCashuSendQuote = {
  userId: string;
  accountId: string;
  paymentRequest: string;
  paymentHash: string;
  expiresAt: string;
  amountRequested: Money;
  amountRequestedInMsat: number;
  amountToReceive: Money;
  lightningFeeReserve: Money;
  cashuFee: Money;
  quoteId: string;
  keysetId: string;
  numberOfChangeOutputs: number;
  proofsToSend: CashuProof[];
  amountReserved: Money;
  destinationDetails?: DestinationDetails;
  purpose?: string;
  transferId?: string;
};

/**
 * Reads + writes for the `wallet.cashu_send_quotes` table, scoped (via RLS) to the signed-in
 * user. Holds the SDK-owned Supabase client + the SDK {@link Encryption}.
 */
export class CashuSendQuoteRepository {
  constructor(
    private readonly db: WalletSupabaseClient,
    private readonly encryption: Encryption,
  ) {}

  /**
   * Create a cashu lightning send quote (RPC `create_cashu_send_quote`). The RPC reserves the
   * input proofs atomically (UNSPENT → RESERVED) and raises `CONCURRENCY_ERROR` on a stale
   * read — surfaced as {@link ConcurrencyError}.
   */
  async create(
    params: CreateCashuSendQuote,
    options?: Options,
  ): Promise<CashuSendQuote> {
    const sendData = CashuLightningSendDbDataSchema.parse({
      paymentRequest: params.paymentRequest,
      amountRequested: params.amountRequested,
      amountRequestedInMsat: params.amountRequestedInMsat,
      amountReceived: params.amountToReceive,
      lightningFeeReserve: params.lightningFeeReserve,
      cashuSendFee: params.cashuFee,
      meltQuoteId: params.quoteId,
      amountReserved: params.amountReserved,
      destinationDetails: params.destinationDetails,
    } satisfies z.input<typeof CashuLightningSendDbDataSchema>);

    const [encryptedData, quoteIdHash] = await Promise.all([
      this.encryption.encrypt(sendData),
      computeSHA256(params.quoteId),
    ]);

    const { data, error } = await this.rpc(
      'create_cashu_send_quote',
      {
        p_user_id: params.userId,
        p_account_id: params.accountId,
        p_currency: params.amountToReceive.currency,
        p_currency_requested: params.amountRequested.currency,
        p_expires_at: params.expiresAt,
        p_keyset_id: params.keysetId,
        p_number_of_change_outputs: params.numberOfChangeOutputs,
        p_proofs_to_send: params.proofsToSend.map((p) => p.id),
        p_encrypted_data: encryptedData,
        p_quote_id_hash: quoteIdHash,
        p_payment_hash: params.paymentHash,
        p_purpose: params.purpose,
        p_transfer_id: params.transferId,
      },
      options,
    );

    if (error) {
      if (error.hint === 'CONCURRENCY_ERROR') {
        throw new ConcurrencyError(error.message, error.details);
      }
      throw new Error('Failed to create cashu send quote', { cause: error });
    }

    return this.toQuote({ ...data.quote, cashu_proofs: data.reserved_proofs });
  }

  /**
   * Complete the send quote after a successful lightning payment (RPC
   * `complete_cashu_send_quote`): stores the NUT-08 change proofs + the final fee data.
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
    } satisfies z.input<typeof CashuLightningSendDbDataSchema>);

    const proofDataToEncrypt = changeProofs.flatMap((x) => [
      x.amount,
      x.secret,
    ]);
    const [encryptedData, ...encryptedProofData] =
      await this.encryption.encryptBatch([sendData, ...proofDataToEncrypt]);
    const encryptedProofs = changeProofs.map((x, index) => {
      const i = index * 2;
      return {
        keysetId: x.id,
        amount: encryptedProofData[i],
        secret: encryptedProofData[i + 1],
        unblindedSignature: x.C,
        publicKeyY: proofToY(x),
        dleq: x.dleq ?? null,
        witness: x.witness ?? null,
      };
    });

    const { data, error } = await this.rpc(
      'complete_cashu_send_quote',
      {
        p_quote_id: quote.id,
        p_change_proofs: encryptedProofs,
        p_encrypted_data: encryptedData,
      },
      options,
    );

    if (error) {
      throw new Error('Failed to complete cashu send quote', { cause: error });
    }

    return this.toQuote({ ...data.quote, cashu_proofs: data.spent_proofs });
  }

  /** Mark the send quote PENDING (RPC `mark_cashu_send_quote_as_pending`). */
  async markAsPending(id: string, options?: Options): Promise<CashuSendQuote> {
    const { data, error } = await this.rpc(
      'mark_cashu_send_quote_as_pending',
      { p_quote_id: id },
      options,
    );
    if (error) {
      throw new Error('Failed to mark cashu send as pending', { cause: error });
    }
    return this.toQuote({ ...data.quote, cashu_proofs: data.proofs });
  }

  /** Fail the send quote (RPC `fail_cashu_send_quote`), releasing the reserved proofs. */
  async fail(
    { id, reason }: { id: string; reason: string },
    options?: Options,
  ): Promise<CashuSendQuote> {
    const { data, error } = await this.rpc(
      'fail_cashu_send_quote',
      { p_quote_id: id, p_failure_reason: reason },
      options,
    );
    if (error) {
      throw new Error('Failed to fail cashu send quote', { cause: error });
    }
    return this.toQuote({ ...data.quote, cashu_proofs: data.released_proofs });
  }

  /** Expire the send quote (RPC `expire_cashu_send_quote`), returning the reserved proofs. */
  async expire(id: string, options?: Options): Promise<void> {
    const { error } = await this.rpc(
      'expire_cashu_send_quote',
      { p_quote_id: id },
      options,
    );
    if (error) {
      throw new Error('Failed to expire cashu send quote', { cause: error });
    }
  }

  /** Get the send quote with the given id (joined with its reserved proofs), or null. */
  async get(id: string, options?: Options): Promise<CashuSendQuote | null> {
    let query = this.db
      .from('cashu_send_quotes')
      .select('*, cashu_proofs!spending_cashu_send_quote_id(*)')
      .eq('id', id);
    if (options?.abortSignal) {
      query = query.abortSignal(options.abortSignal);
    }
    const { data, error } = await query.maybeSingle<CashuSendQuoteRow>();
    if (error) {
      throw new Error('Failed to get cashu send', { cause: error });
    }
    return data ? this.toQuote(data) : null;
  }

  /**
   * Get all unresolved (UNPAID or PENDING) send quotes for the user. INTERNAL — feeds the
   * future orchestrator's resume sweep (the public interface has no `listPending`).
   */
  async getUnresolved(
    userId: string,
    options?: Options,
  ): Promise<CashuSendQuote[]> {
    let query = this.db
      .from('cashu_send_quotes')
      .select('*, cashu_proofs!spending_cashu_send_quote_id(*)')
      .eq('user_id', userId)
      .in('state', ['UNPAID', 'PENDING']);
    if (options?.abortSignal) {
      query = query.abortSignal(options.abortSignal);
    }
    const { data, error } = await query.returns<CashuSendQuoteRow[]>();
    if (error) {
      throw new Error('Failed to get pending cashu send quotes', {
        cause: error,
      });
    }
    return Promise.all(data.map((x) => this.toQuote(x)));
  }

  /** Map a DB row (joined with its proofs) to the domain {@link CashuSendQuote}. */
  async toQuote(data: CashuSendQuoteRow): Promise<CashuSendQuote> {
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
    }) as CashuSendQuote;
  }

  /**
   * Thin typed wrapper over the untyped Supabase `rpc` (the DB generic is `any` until the
   * generated types are lifted). Centralises the one cast so the call sites stay clean.
   */
  private async rpc(
    fn: string,
    args: Record<string, unknown>,
    options?: Options,
    // biome-ignore lint/suspicious/noExplicitAny: the Supabase client is untyped until the generated Database types are lifted (a later slice); the RPC arg shape is enforced by the stored procedure.
  ): Promise<{ data: any; error: any }> {
    // biome-ignore lint/suspicious/noExplicitAny: see above — the rpc name/args are not in the untyped client's type space.
    let query = (this.db.rpc as any)(fn, args);
    if (options?.abortSignal) {
      query = query.abortSignal(options.abortSignal);
    }
    return query;
  }
}

/** A `cashu_send_quotes` row joined with its reserved `cashu_proofs`. */
type CashuSendQuoteRow = AgicashDbCashuSendQuote & {
  cashu_proofs: AgicashDbCashuProof[];
};
