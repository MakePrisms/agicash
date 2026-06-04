/**
 * Internal `wallet.spark_send_quotes` repository — Slice 3 / PR5c (spark lightning send).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/send/spark-send-quote-repository.ts`. Master expresses this
 * over a React-hook-constructed repo wired to the module-global `agicashDbClient` +
 * `useEncryption`; here it is a plain class over the SDK-owned Supabase client + the SDK's
 * {@link Encryption} (both injected). The RPCs (`create_spark_send_quote` /
 * `mark_spark_send_quote_as_pending` / `complete_spark_send_quote` / `fail_spark_send_quote`)
 * are unchanged — the `payment_hash` active-uniqueness guard (the duplicate-send protection)
 * lives in the stored procedure / partial index and is preserved verbatim (surfaced as a
 * {@link DomainError} on the `23505` unique violation, exactly as master).
 *
 * Re-housing details (matching `cashu-send-quote-repository.ts`):
 *  - the encrypted-jsonb schema (`SparkLightningSendDbDataSchema`) + the domain schema
 *    (`SparkSendQuoteSchema`) come from the SDK-internal single-source re-export
 *    (`./lib-spark-quotes`), so the runtime shapes can never drift from `types/spark.ts`;
 *  - the DB-row type is the hand-written {@link AgicashDbSparkSendQuote} (matching
 *    `db-account.ts` / the cashu repos, since the generated `database.types` are not lifted);
 *  - the untyped `rpc` wrapper centralises the one Supabase-client cast (the client's generic
 *    is `any` until the generated types land);
 *  - master's `satisfies AllUnionFieldsRequired<…>` compile-time assertion on the `toQuote`
 *    object is dropped (matching the cashu repos) — the runtime `.parse()` still enforces the
 *    per-state invariants (e.g. `sparkId`/`sparkTransferId`/`fee`/`paymentPreimage` present
 *    when COMPLETED); the result is cast `as SparkSendQuote`.
 *  - `measureOperation` telemetry is not in this layer (it wraps Breez calls in the service).
 *
 * @module
 */
import type { z } from 'zod/mini';
import {
  SparkLightningSendDbDataSchema,
  SparkSendQuoteSchema,
} from './lib-spark-quotes';
import type { WalletSupabaseClient } from './supabase-client';
import { DomainError } from '../errors';
import type { Encryption } from './encryption';
import type { Money } from '../types/money';
import type { SparkSendQuote } from '../types/spark';

/** Per-call query options (an abort signal, matching master). */
type Options = { abortSignal?: AbortSignal };

/**
 * A row of the `wallet.spark_send_quotes` table (hand-written; master = generated
 * `database.types`). Only the columns `toQuote` reads are typed; `encrypted_data` is the
 * ciphertext jsonb the repo decrypts.
 */
export type AgicashDbSparkSendQuote = {
  id: string;
  created_at: string;
  expires_at: string | null;
  user_id: string;
  account_id: string;
  transaction_id: string;
  payment_hash: string;
  payment_request_is_amountless: boolean;
  encrypted_data: string;
  spark_id: string | null;
  spark_transfer_id: string | null;
  version: number;
  state: SparkSendQuote['state'];
  failure_reason?: string | null;
};

/** Params for {@link SparkSendQuoteRepository.create} (master `CreateQuoteParams`). */
export type CreateSparkSendQuote = {
  userId: string;
  accountId: string;
  amount: Money;
  estimatedFee: Money;
  paymentRequest: string;
  paymentHash: string;
  paymentRequestIsAmountless: boolean;
  expiresAt?: Date | null;
  purpose?: string;
  transferId?: string;
};

/**
 * Reads + writes for the `wallet.spark_send_quotes` table, scoped (via RLS) to the signed-in
 * user. Holds the SDK-owned Supabase client + the SDK {@link Encryption}.
 */
export class SparkSendQuoteRepository {
  constructor(
    private readonly db: WalletSupabaseClient,
    private readonly encryption: Encryption,
  ) {}

  /**
   * Create a spark send quote (RPC `create_spark_send_quote`). The `payment_hash` active-unique
   * partial index (covering UNPAID/PENDING/COMPLETED) raises `23505` if a send for the same
   * invoice is already in flight or done — surfaced as a {@link DomainError}. Master verbatim.
   */
  async create(
    params: CreateSparkSendQuote,
    options?: Options,
  ): Promise<SparkSendQuote> {
    const sendData = SparkLightningSendDbDataSchema.parse({
      paymentRequest: params.paymentRequest,
      amountReceived: params.amount,
      estimatedLightningFee: params.estimatedFee,
    } satisfies z.input<typeof SparkLightningSendDbDataSchema>);

    const encryptedData = await this.encryption.encrypt(sendData);

    const { data, error } = await this.rpc(
      'create_spark_send_quote',
      {
        p_user_id: params.userId,
        p_account_id: params.accountId,
        p_currency: params.amount.currency,
        p_payment_hash: params.paymentHash,
        p_payment_request_is_amountless: params.paymentRequestIsAmountless,
        p_encrypted_data: encryptedData,
        p_expires_at: params.expiresAt?.toISOString(),
        p_purpose: params.purpose,
        p_transfer_id: params.transferId,
      },
      options,
    );

    if (error) {
      if (error.code === '23505') {
        // Hits the spark_send_quotes_payment_hash_active_unique partial index, which covers
        // UNPAID, PENDING, and COMPLETED — so the existing quote could be in any of those states.
        throw new DomainError(
          'A payment for this invoice is already being processed or was completed',
        );
      }
      throw new Error('Failed to create spark send quote', { cause: error });
    }

    return this.toQuote(data);
  }

  /**
   * Mark a spark send quote PENDING, recording the spark send-request id, transfer id, and the
   * actual fee (RPC `mark_spark_send_quote_as_pending`). Master verbatim.
   */
  async markAsPending(
    {
      quote,
      sparkSendRequestId,
      sparkTransferId,
      fee,
    }: {
      quote: SparkSendQuote;
      sparkSendRequestId: string;
      sparkTransferId: string;
      fee: Money;
    },
    options?: Options,
  ): Promise<SparkSendQuote> {
    const sendData = SparkLightningSendDbDataSchema.parse({
      paymentRequest: quote.paymentRequest,
      amountReceived: quote.amount,
      estimatedLightningFee: quote.estimatedFee,
      amountSpent: quote.amount.add(fee),
      lightningFee: fee,
    } satisfies z.input<typeof SparkLightningSendDbDataSchema>);

    const encryptedData = await this.encryption.encrypt(sendData);

    const { data, error } = await this.rpc(
      'mark_spark_send_quote_as_pending',
      {
        p_quote_id: quote.id,
        p_spark_id: sparkSendRequestId,
        p_spark_transfer_id: sparkTransferId,
        p_encrypted_data: encryptedData,
      },
      options,
    );

    if (error) {
      throw new Error('Failed to mark spark send quote as pending', {
        cause: error,
      });
    }

    return this.toQuote(data);
  }

  /**
   * Complete a spark send quote after a successful payment (RPC `complete_spark_send_quote`),
   * storing the preimage + final fee data. Master verbatim.
   */
  async complete(
    {
      quote,
      paymentPreimage,
    }: {
      quote: SparkSendQuote & { state: 'PENDING' };
      paymentPreimage: string;
    },
    options?: Options,
  ): Promise<SparkSendQuote> {
    const sendData = SparkLightningSendDbDataSchema.parse({
      paymentRequest: quote.paymentRequest,
      amountReceived: quote.amount,
      estimatedLightningFee: quote.estimatedFee,
      amountSpent: quote.amount.add(quote.fee),
      lightningFee: quote.fee,
      paymentPreimage,
    } satisfies z.input<typeof SparkLightningSendDbDataSchema>);

    const encryptedData = await this.encryption.encrypt(sendData);

    const { data, error } = await this.rpc(
      'complete_spark_send_quote',
      {
        p_quote_id: quote.id,
        p_encrypted_data: encryptedData,
      },
      options,
    );

    if (error) {
      throw new Error('Failed to complete spark send quote', { cause: error });
    }

    return this.toQuote(data);
  }

  /** Fail a spark send quote (RPC `fail_spark_send_quote`). Master verbatim. */
  async fail(
    quoteId: string,
    failureReason: string,
    options?: Options,
  ): Promise<SparkSendQuote> {
    const { data, error } = await this.rpc(
      'fail_spark_send_quote',
      {
        p_quote_id: quoteId,
        p_failure_reason: failureReason,
      },
      options,
    );

    if (error) {
      throw new Error('Failed to fail spark send quote', { cause: error });
    }

    return this.toQuote(data);
  }

  /** Get the spark send quote with the given id, or null. Master verbatim. */
  async get(id: string, options?: Options): Promise<SparkSendQuote | null> {
    let query = this.db.from('spark_send_quotes').select().eq('id', id);
    if (options?.abortSignal) {
      query = query.abortSignal(options.abortSignal);
    }
    const { data, error } = await query.maybeSingle<AgicashDbSparkSendQuote>();
    if (error) {
      throw new Error('Failed to get spark send quote', { cause: error });
    }
    return data ? this.toQuote(data) : null;
  }

  /**
   * Get all unresolved (UNPAID or PENDING) spark send quotes for the user. INTERNAL — feeds the
   * future orchestrator's resume sweep (the public interface has no `listPending`). Master verbatim.
   */
  async getUnresolved(
    userId: string,
    options?: Options,
  ): Promise<SparkSendQuote[]> {
    let query = this.db
      .from('spark_send_quotes')
      .select()
      .eq('user_id', userId)
      .in('state', ['UNPAID', 'PENDING']);
    if (options?.abortSignal) {
      query = query.abortSignal(options.abortSignal);
    }
    const { data, error } = await query.returns<AgicashDbSparkSendQuote[]>();
    if (error) {
      throw new Error('Failed to get spark send quotes', { cause: error });
    }
    return Promise.all(data.map((row) => this.toQuote(row)));
  }

  /** Map a DB row to the domain {@link SparkSendQuote}. Master verbatim. */
  async toQuote(data: AgicashDbSparkSendQuote): Promise<SparkSendQuote> {
    const decryptedData = await this.encryption.decrypt(data.encrypted_data);
    const sendData = SparkLightningSendDbDataSchema.parse(decryptedData);

    // The runtime `.parse()` does the spark-send-quote invariant check (e.g. it makes sure
    // sparkId, sparkTransferId, fee and paymentPreimage are not undefined when state is
    // COMPLETED). Cast to the domain type matches the cashu repos' `toQuote` approach.
    return SparkSendQuoteSchema.parse({
      id: data.id,
      sparkId: data.spark_id ?? undefined,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      amount: sendData.amountReceived,
      estimatedFee: sendData.estimatedLightningFee,
      paymentRequest: sendData.paymentRequest,
      paymentHash: data.payment_hash,
      transactionId: data.transaction_id,
      userId: data.user_id,
      accountId: data.account_id,
      version: data.version,
      paymentRequestIsAmountless: data.payment_request_is_amountless,
      state: data.state,
      sparkTransferId: data.spark_transfer_id ?? undefined,
      fee: sendData.lightningFee,
      paymentPreimage: sendData.paymentPreimage,
      failureReason: data.failure_reason ?? undefined,
    }) as SparkSendQuote;
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
