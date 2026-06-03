/**
 * Internal `wallet.spark_receive_quotes` repository — Slice 3 / PR5c (spark lightning receive).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/receive/spark-receive-quote-repository.ts`. Master expresses
 * this over a React-hook-constructed repo wired to the module-global `agicashDbClient` +
 * `useEncryption`; here it is a plain class over the SDK-owned Supabase client + the SDK's
 * {@link Encryption} (both injected). The RPCs (`create_spark_receive_quote` /
 * `complete_spark_receive_quote` / `expire_…` / `fail_…` /
 * `mark_spark_receive_quote_cashu_token_melt_initiated`) are unchanged.
 *
 * Re-housing details match `spark-send-quote-repository.ts`: single-source schemas from
 * `./lib-spark-quotes`; hand-written {@link AgicashDbSparkReceiveQuote} row; the untyped `rpc`
 * wrapper; master's `satisfies AllUnionFieldsRequired<…>` dropped (the runtime `.parse()` keeps
 * the invariant check — e.g. `tokenReceiveData` present when type is CASHU_TOKEN), result cast
 * `as SparkReceiveQuote`. NOTE the spark receive repos do NOT return an `Account` (unlike the
 * cashu receive repos): a spark receive credits the Breez-held balance, not DB-stored proofs, so
 * there is no account row to re-map here.
 *
 * @module
 */
import type { z } from 'zod/mini';
import {
  SparkLightningReceiveDbDataSchema,
  SparkReceiveQuoteSchema,
} from './lib-spark-quotes';
import type { RepositoryCreateQuoteParams } from './spark-receive-quote-core';
import type { WalletSupabaseClient } from './supabase-client';
import type { Encryption } from './encryption';
import type { SparkReceiveQuote } from '../types/spark';

/** Per-call query options (an abort signal, matching master). */
type Options = { abortSignal?: AbortSignal };

/**
 * A row of the `wallet.spark_receive_quotes` table (hand-written; master = generated
 * `database.types`). Only the columns `toQuote` reads are typed; `encrypted_data` is the
 * ciphertext jsonb the repo decrypts.
 */
export type AgicashDbSparkReceiveQuote = {
  id: string;
  created_at: string;
  expires_at: string;
  user_id: string;
  account_id: string;
  transaction_id: string;
  payment_hash: string;
  encrypted_data: string;
  spark_id: string;
  spark_transfer_id: string | null;
  receiver_identity_pubkey: string | null;
  cashu_token_melt_initiated: boolean | null;
  version: number;
  type: SparkReceiveQuote['type'];
  state: SparkReceiveQuote['state'];
  failure_reason?: string | null;
};

/** Params for {@link SparkReceiveQuoteRepository.create} (master `RepositoryCreateQuoteParams`). */
type CreateQuoteParams = RepositoryCreateQuoteParams;

/**
 * Reads + writes for the `wallet.spark_receive_quotes` table, scoped (via RLS) to the signed-in
 * user. Holds the SDK-owned Supabase client + the SDK {@link Encryption}.
 */
export class SparkReceiveQuoteRepository {
  constructor(
    private readonly db: WalletSupabaseClient,
    private readonly encryption: Encryption,
  ) {}

  /** Create a spark receive quote (RPC `create_spark_receive_quote`). Master verbatim. */
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
      receiveType,
      description,
      totalFee,
    } = params;

    const receiveData = SparkLightningReceiveDbDataSchema.parse({
      paymentRequest,
      amountReceived: amount,
      description,
      cashuTokenMeltData:
        receiveType === 'CASHU_TOKEN' ? params.meltData : undefined,
      totalFee,
    } satisfies z.input<typeof SparkLightningReceiveDbDataSchema>);

    const encryptedData = await this.encryption.encrypt(receiveData);

    const { data, error } = await this.rpc(
      'create_spark_receive_quote',
      {
        p_user_id: userId,
        p_account_id: accountId,
        p_currency: amount.currency,
        p_payment_hash: paymentHash,
        p_expires_at: expiresAt,
        p_spark_id: sparkId,
        p_receiver_identity_pubkey: receiverIdentityPubkey ?? null,
        p_receive_type: receiveType,
        p_encrypted_data: encryptedData,
        p_purpose: params.purpose,
        p_transfer_id: params.transferId,
      },
      options,
    );

    if (error) {
      throw new Error('Failed to create spark receive quote', { cause: error });
    }

    return this.toQuote(data);
  }

  /** Complete a spark receive quote (RPC `complete_spark_receive_quote`). Master verbatim. */
  async complete(
    {
      quote,
      paymentPreimage,
      sparkTransferId,
    }: {
      quote: SparkReceiveQuote;
      paymentPreimage: string;
      sparkTransferId: string;
    },
    options?: Options,
  ): Promise<SparkReceiveQuote> {
    const cashuTokenMeltData =
      quote.type === 'CASHU_TOKEN'
        ? {
            tokenMintUrl: quote.tokenReceiveData.sourceMintUrl,
            meltQuoteId: quote.tokenReceiveData.meltQuoteId,
            tokenAmount: quote.tokenReceiveData.tokenAmount,
            tokenProofs: quote.tokenReceiveData.tokenProofs,
            cashuReceiveFee: quote.tokenReceiveData.cashuReceiveFee,
            lightningFeeReserve: quote.tokenReceiveData.lightningFeeReserve,
          }
        : undefined;

    const receiveData = SparkLightningReceiveDbDataSchema.parse({
      paymentRequest: quote.paymentRequest,
      amountReceived: quote.amount,
      description: quote.description,
      cashuTokenMeltData,
      totalFee: quote.totalFee,
      paymentPreimage,
    } satisfies z.input<typeof SparkLightningReceiveDbDataSchema>);

    const encryptedData = await this.encryption.encrypt(receiveData);

    const { data, error } = await this.rpc(
      'complete_spark_receive_quote',
      {
        p_quote_id: quote.id,
        p_spark_transfer_id: sparkTransferId,
        p_encrypted_data: encryptedData,
      },
      options,
    );

    if (error) {
      throw new Error('Failed to complete spark receive quote', {
        cause: error,
      });
    }

    return this.toQuote(data);
  }

  /** Expire a spark receive quote (RPC `expire_spark_receive_quote`). Master verbatim. */
  async expire(quoteId: string, options?: Options): Promise<SparkReceiveQuote> {
    const { data, error } = await this.rpc(
      'expire_spark_receive_quote',
      { p_quote_id: quoteId },
      options,
    );

    if (error) {
      throw new Error('Failed to expire spark receive quote', { cause: error });
    }

    return this.toQuote(data);
  }

  /** Fail a spark receive quote (RPC `fail_spark_receive_quote`). Master verbatim. */
  async fail(
    { id, reason }: { id: string; reason: string },
    options?: Options,
  ): Promise<void> {
    const { error } = await this.rpc(
      'fail_spark_receive_quote',
      { p_quote_id: id, p_failure_reason: reason },
      options,
    );

    if (error) {
      throw new Error('Failed to fail spark receive quote', { cause: error });
    }
  }

  /**
   * Mark the melt initiated for a CASHU_TOKEN spark receive quote (RPC
   * `mark_spark_receive_quote_cashu_token_melt_initiated`). Master verbatim.
   */
  async markMeltInitiated(
    quote: SparkReceiveQuote & { type: 'CASHU_TOKEN' },
    options?: Options,
  ): Promise<SparkReceiveQuote & { type: 'CASHU_TOKEN' }> {
    const { data, error } = await this.rpc(
      'mark_spark_receive_quote_cashu_token_melt_initiated',
      { p_quote_id: quote.id },
      options,
    );

    if (error) {
      throw new Error('Failed to mark melt initiated for spark receive quote', {
        cause: error,
      });
    }

    const updatedQuote = await this.toQuote(data);
    return updatedQuote as SparkReceiveQuote & { type: 'CASHU_TOKEN' };
  }

  /** Get the spark receive quote with the given id, or null. Master verbatim. */
  async get(id: string, options?: Options): Promise<SparkReceiveQuote | null> {
    let query = this.db.from('spark_receive_quotes').select().eq('id', id);
    if (options?.abortSignal) {
      query = query.abortSignal(options.abortSignal);
    }
    const { data, error } =
      await query.maybeSingle<AgicashDbSparkReceiveQuote>();
    if (error) {
      throw new Error('Failed to get spark receive quote', { cause: error });
    }
    return data ? this.toQuote(data) : null;
  }

  /**
   * Get all pending (UNPAID) spark receive quotes for the user. INTERNAL — feeds the future
   * orchestrator's resume sweep (the public interface has no `listPending`). Master verbatim.
   */
  async getPending(
    userId: string,
    options?: Options,
  ): Promise<SparkReceiveQuote[]> {
    let query = this.db
      .from('spark_receive_quotes')
      .select()
      .eq('user_id', userId)
      .eq('state', 'UNPAID');
    if (options?.abortSignal) {
      query = query.abortSignal(options.abortSignal);
    }
    const { data, error } = await query.returns<AgicashDbSparkReceiveQuote[]>();
    if (error) {
      throw new Error('Failed to get spark receive quotes', { cause: error });
    }
    return Promise.all(data.map((row) => this.toQuote(row)));
  }

  /** Map a DB row to the domain {@link SparkReceiveQuote}. Master verbatim. */
  async toQuote(data: AgicashDbSparkReceiveQuote): Promise<SparkReceiveQuote> {
    const decryptedData = await this.encryption.decrypt(data.encrypted_data);
    const receiveData = SparkLightningReceiveDbDataSchema.parse(decryptedData);

    // The runtime `.parse()` does the spark-receive-quote invariant check (e.g. it makes sure
    // tokenReceiveData is present when type is CASHU_TOKEN, etc.). Cast to the domain type
    // matches the cashu repos' `toQuote` approach.
    return SparkReceiveQuoteSchema.parse({
      id: data.id,
      sparkId: data.spark_id,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      amount: receiveData.amountReceived,
      paymentRequest: receiveData.paymentRequest,
      paymentHash: data.payment_hash,
      receiverIdentityPubkey: data.receiver_identity_pubkey ?? undefined,
      transactionId: data.transaction_id,
      userId: data.user_id,
      accountId: data.account_id,
      version: data.version,
      description: receiveData.description,
      totalFee: receiveData.totalFee,
      type: data.type,
      state: data.state,
      paymentPreimage: receiveData.paymentPreimage,
      sparkTransferId: data.spark_transfer_id,
      failureReason: data.failure_reason ?? undefined,
      tokenReceiveData: receiveData.cashuTokenMeltData
        ? {
            sourceMintUrl: receiveData.cashuTokenMeltData.tokenMintUrl,
            tokenAmount: receiveData.cashuTokenMeltData.tokenAmount,
            tokenProofs: receiveData.cashuTokenMeltData.tokenProofs,
            meltQuoteId: receiveData.cashuTokenMeltData.meltQuoteId,
            // the runtime parse checks cashu_token_melt_initiated is not null when CASHU_TOKEN
            meltInitiated: data.cashu_token_melt_initiated as boolean,
            cashuReceiveFee: receiveData.cashuTokenMeltData.cashuReceiveFee,
            lightningFeeReserve:
              receiveData.cashuTokenMeltData.lightningFeeReserve,
          }
        : undefined,
    }) as SparkReceiveQuote;
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
