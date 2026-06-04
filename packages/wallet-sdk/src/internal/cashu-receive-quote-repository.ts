/**
 * Internal `wallet.cashu_receive_quotes` repository — Slice 3 / PR5b (cashu lightning receive).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/receive/cashu-receive-quote-repository.ts`. Same re-housing as
 * the send repos. Two RPCs (`process_cashu_receive_quote_payment` / `complete_cashu_receive_quote`)
 * return an updated account row alongside the quote; master maps it via
 * `accountRepository.toAccount`. Here that mapper is INJECTED ({@link AccountMapper}) — the
 * resolver-backed `dbAccountToAccount` (Slice 2/3) — so the repo stays framework-free and does
 * not depend on the account repository class.
 *
 * @module
 */
import type { Proof } from '@cashu/cashu-ts';
import type { z } from 'zod/mini';
import type { AgicashDbAccountWithProofs } from './db-account';
import {
  CashuLightningReceiveDbDataSchema,
  CashuReceiveQuoteSchema,
  proofToY,
} from './lib-cashu-quotes';
import type { RepositoryCreateQuoteParams } from './cashu-receive-quote-core';
import type { WalletSupabaseClient } from './supabase-client';
import { computeSHA256 } from './crypto';
import type { Encryption } from './encryption';
import type { CashuAccount } from '../types/account';
import type { CashuReceiveQuote } from '../types/cashu';

/** Per-call query options (an abort signal, matching master). */
type Options = { abortSignal?: AbortSignal };

/** Maps a returned account row (joined with proofs) to the domain {@link CashuAccount}. */
export type AccountMapper = (
  row: AgicashDbAccountWithProofs,
) => Promise<CashuAccount>;

/**
 * A row of the `wallet.cashu_receive_quotes` table (hand-written; master = generated types).
 * Only the columns `toQuote` reads are typed.
 */
export type AgicashDbCashuReceiveQuote = {
  id: string;
  user_id: string;
  account_id: string;
  transaction_id: string;
  encrypted_data: string;
  payment_hash: string;
  locking_derivation_path: string;
  created_at: string;
  expires_at: string;
  version: number;
  type: CashuReceiveQuote['type'];
  state: CashuReceiveQuote['state'];
  cashu_token_melt_initiated: boolean | null;
  keyset_id: string | null;
  keyset_counter: number | null;
  failure_reason?: string | null;
};

/** Reads + writes for the `wallet.cashu_receive_quotes` table (RLS-scoped). */
export class CashuReceiveQuoteRepository {
  constructor(
    private readonly db: WalletSupabaseClient,
    private readonly encryption: Encryption,
    private readonly mapAccount: AccountMapper,
  ) {}

  /** Create a receive quote (RPC `create_cashu_receive_quote`). */
  async create(
    params: RepositoryCreateQuoteParams,
    options?: Options,
  ): Promise<CashuReceiveQuote> {
    const receiveData = CashuLightningReceiveDbDataSchema.parse({
      paymentRequest: params.paymentRequest,
      mintQuoteId: params.quoteId,
      amountReceived: params.amount,
      description: params.description,
      mintingFee: params.mintingFee,
      cashuTokenMeltData:
        params.receiveType === 'CASHU_TOKEN' ? params.meltData : undefined,
      totalFee: params.totalFee,
    } satisfies z.input<typeof CashuLightningReceiveDbDataSchema>);

    const [encryptedReceiveData, quoteIdHash] = await Promise.all([
      this.encryption.encrypt(receiveData),
      computeSHA256(params.quoteId),
    ]);

    const { data, error } = await this.rpc(
      'create_cashu_receive_quote',
      {
        p_user_id: params.userId,
        p_account_id: params.accountId,
        p_currency: params.amount.currency,
        p_expires_at: params.expiresAt,
        p_locking_derivation_path: params.lockingDerivationPath,
        p_receive_type: params.receiveType,
        p_encrypted_data: encryptedReceiveData,
        p_quote_id_hash: quoteIdHash,
        p_payment_hash: params.paymentHash,
        p_purpose: params.purpose,
        p_transfer_id: params.transferId,
      },
      options,
    );

    if (error) {
      throw new Error('Failed to create cashu receive quote', { cause: error });
    }

    return this.toQuote(data);
  }

  /** Expire the receive quote (RPC `expire_cashu_receive_quote`). */
  async expire(id: string, options?: Options): Promise<void> {
    const { error } = await this.rpc(
      'expire_cashu_receive_quote',
      { p_quote_id: id },
      options,
    );
    if (error) {
      throw new Error('Failed to expire cashu receive quote', { cause: error });
    }
  }

  /** Fail the receive quote (RPC `fail_cashu_receive_quote`). */
  async fail(
    { id, reason }: { id: string; reason: string },
    options?: Options,
  ): Promise<void> {
    const { error } = await this.rpc(
      'fail_cashu_receive_quote',
      { p_quote_id: id, p_failure_reason: reason },
      options,
    );
    if (error) {
      throw new Error('Failed to fail cashu receive quote', { cause: error });
    }
  }

  /** Mark the melt initiated for a CASHU_TOKEN receive (RPC `…_cashu_token_melt_initiated`). */
  async markMeltInitiated(
    quote: CashuReceiveQuote & { type: 'CASHU_TOKEN' },
    options?: Options,
  ): Promise<CashuReceiveQuote & { type: 'CASHU_TOKEN' }> {
    const { data, error } = await this.rpc(
      'mark_cashu_receive_quote_cashu_token_melt_initiated',
      { p_quote_id: quote.id },
      options,
    );
    if (error) {
      throw new Error('Failed to mark melt initiated for cashu receive quote', {
        cause: error,
      });
    }
    return (await this.toQuote(data)) as CashuReceiveQuote & {
      type: 'CASHU_TOKEN';
    };
  }

  /**
   * Process the payment of a receive quote (RPC `process_cashu_receive_quote_payment`): marks
   * the quote PAID, persists the output amounts, and bumps the account's keyset counter.
   * Returns the updated quote + account.
   */
  async processPayment(
    {
      quote,
      keysetId,
      outputAmounts,
    }: {
      quote: CashuReceiveQuote;
      keysetId: string;
      outputAmounts: number[];
    },
    options?: Options,
  ): Promise<{ quote: CashuReceiveQuote; account: CashuAccount }> {
    const cashuTokenMeltData =
      quote.type === 'CASHU_TOKEN'
        ? {
            tokenAmount: quote.tokenReceiveData.tokenAmount,
            tokenProofs: quote.tokenReceiveData.tokenProofs,
            tokenMintUrl: quote.tokenReceiveData.sourceMintUrl,
            meltQuoteId: quote.tokenReceiveData.meltQuoteId,
            cashuReceiveFee: quote.tokenReceiveData.cashuReceiveFee,
            lightningFeeReserve: quote.tokenReceiveData.lightningFeeReserve,
          }
        : undefined;

    const receiveData = CashuLightningReceiveDbDataSchema.parse({
      paymentRequest: quote.paymentRequest,
      mintQuoteId: quote.quoteId,
      amountReceived: quote.amount,
      description: quote.description,
      mintingFee: quote.mintingFee,
      cashuTokenMeltData,
      totalFee: quote.totalFee,
      outputAmounts,
    } satisfies z.input<typeof CashuLightningReceiveDbDataSchema>);

    const encryptedData = await this.encryption.encrypt(receiveData);

    const { data, error } = await this.rpc(
      'process_cashu_receive_quote_payment',
      {
        p_quote_id: quote.id,
        p_keyset_id: keysetId,
        p_number_of_outputs: outputAmounts.length,
        p_encrypted_data: encryptedData,
      },
      options,
    );

    if (error) {
      throw new Error('Failed to mark cashu receive quote as paid', {
        cause: error,
      });
    }

    const [updatedQuote, account] = await Promise.all([
      this.toQuote(data.quote),
      this.mapAccount(data.account),
    ]);

    return { quote: updatedQuote, account };
  }

  /**
   * Complete the receive quote (RPC `complete_cashu_receive_quote`): stores the minted proofs
   * + marks the quote COMPLETED. Returns the updated quote + account + added proof ids.
   */
  async completeReceive(
    { quoteId, proofs }: { quoteId: string; proofs: Proof[] },
    options?: Options,
  ): Promise<{
    quote: CashuReceiveQuote;
    account: CashuAccount;
    addedProofs: string[];
  }> {
    const dataToEncrypt = proofs.flatMap((x) => [x.amount, x.secret]);
    const encryptedData = await this.encryption.encryptBatch(dataToEncrypt);
    const encryptedProofs = proofs.map((x, index) => {
      const i = index * 2;
      return {
        keysetId: x.id,
        amount: encryptedData[i],
        secret: encryptedData[i + 1],
        unblindedSignature: x.C,
        publicKeyY: proofToY(x),
        dleq: x.dleq ?? null,
        witness: x.witness ?? null,
      };
    });

    const { data, error } = await this.rpc(
      'complete_cashu_receive_quote',
      { p_quote_id: quoteId, p_proofs: encryptedProofs },
      options,
    );

    if (error) {
      throw new Error('Failed to complete cashu receive quote', {
        cause: error,
      });
    }

    const [quote, account] = await Promise.all([
      this.toQuote(data.quote),
      this.mapAccount(data.account),
    ]);

    return {
      quote,
      account,
      addedProofs: data.added_proofs.map((x: { id: string }) => x.id),
    };
  }

  /** Get the receive quote with the given id, or null. */
  async get(id: string, options?: Options): Promise<CashuReceiveQuote | null> {
    let query = this.db.from('cashu_receive_quotes').select().eq('id', id);
    if (options?.abortSignal) {
      query = query.abortSignal(options.abortSignal);
    }
    const { data, error } =
      await query.maybeSingle<AgicashDbCashuReceiveQuote>();
    if (error) {
      throw new Error('Failed to get cashu receive quote', { cause: error });
    }
    return data ? this.toQuote(data) : null;
  }

  /**
   * Get all pending (UNPAID or PAID) receive quotes for the user. INTERNAL — feeds the future
   * orchestrator's resume sweep (the public interface has no `listPending`).
   */
  async getPending(
    userId: string,
    options?: Options,
  ): Promise<CashuReceiveQuote[]> {
    let query = this.db
      .from('cashu_receive_quotes')
      .select()
      .eq('user_id', userId)
      .in('state', ['UNPAID', 'PAID']);
    if (options?.abortSignal) {
      query = query.abortSignal(options.abortSignal);
    }
    const { data, error } = await query.returns<AgicashDbCashuReceiveQuote[]>();
    if (error) {
      throw new Error('Failed to get cashu receive quotes', { cause: error });
    }
    return Promise.all(data.map((d) => this.toQuote(d)));
  }

  /** Map a DB row to the domain {@link CashuReceiveQuote}. */
  async toQuote(data: AgicashDbCashuReceiveQuote): Promise<CashuReceiveQuote> {
    const decryptedData = await this.encryption.decrypt(data.encrypted_data);
    const receiveData = CashuLightningReceiveDbDataSchema.parse(decryptedData);

    return CashuReceiveQuoteSchema.parse({
      id: data.id,
      userId: data.user_id,
      accountId: data.account_id,
      quoteId: receiveData.mintQuoteId,
      amount: receiveData.amountReceived,
      description: receiveData.description,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      paymentRequest: receiveData.paymentRequest,
      paymentHash: data.payment_hash,
      version: data.version,
      lockingDerivationPath: data.locking_derivation_path,
      transactionId: data.transaction_id,
      mintingFee: receiveData.mintingFee,
      totalFee: receiveData.totalFee,
      type: data.type,
      state: data.state,
      tokenReceiveData: receiveData.cashuTokenMeltData
        ? {
            sourceMintUrl: receiveData.cashuTokenMeltData.tokenMintUrl,
            tokenAmount: receiveData.cashuTokenMeltData.tokenAmount,
            tokenProofs: receiveData.cashuTokenMeltData.tokenProofs,
            meltQuoteId: receiveData.cashuTokenMeltData.meltQuoteId,
            meltInitiated: data.cashu_token_melt_initiated as boolean,
            cashuReceiveFee: receiveData.cashuTokenMeltData.cashuReceiveFee,
            lightningFeeReserve:
              receiveData.cashuTokenMeltData.lightningFeeReserve,
          }
        : undefined,
      keysetId: data.keyset_id,
      keysetCounter: data.keyset_counter,
      outputAmounts: receiveData.outputAmounts,
      failureReason: data.failure_reason ?? undefined,
    }) as CashuReceiveQuote;
  }

  /** Thin typed wrapper over the untyped Supabase `rpc` (see send-quote repo for the rationale). */
  private async rpc(
    fn: string,
    args: Record<string, unknown>,
    options?: Options,
    // biome-ignore lint/suspicious/noExplicitAny: the Supabase client is untyped until the generated Database types are lifted (a later slice); the RPC arg shape is enforced by the stored procedure.
  ): Promise<{ data: any; error: any }> {
    // biome-ignore lint/suspicious/noExplicitAny: see above.
    let query = (this.db.rpc as any)(fn, args);
    if (options?.abortSignal) {
      query = query.abortSignal(options.abortSignal);
    }
    return query;
  }
}
