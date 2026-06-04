/**
 * Internal `wallet.cashu_send_swaps` repository — Slice 3 / PR5b (cashu TOKEN send).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/send/cashu-send-swap-repository.ts`. Same re-housing as the
 * send-quote repo: a plain class over the SDK-owned Supabase client + the SDK {@link Encryption}.
 * The RPCs (`create_cashu_send_swap` / `commit_proofs_to_send` / `complete_cashu_send_swap` /
 * `fail_cashu_send_swap`) carry the DB reservation + CONCURRENCY_ERROR guard verbatim.
 *
 * NOTE the `CashuSendSwap.createdAt: Date` quirk — `toSwap` passes `new Date(data.created_at)`
 * (master verbatim), unlike the ISO-string `createdAt` everywhere else.
 *
 * @module
 */
import type { Proof } from '@cashu/cashu-ts';
import type { z } from 'zod/mini';
import type { AgicashDbCashuProof } from './db-account';
import {
  CashuSendSwapSchema,
  CashuSwapSendDbDataSchema,
  proofToY,
  toDecryptedCashuProofs,
} from './lib-cashu-quotes';
import type { WalletSupabaseClient } from './supabase-client';
import { ConcurrencyError } from '../errors';
import type { Encryption } from './encryption';
import type { CashuProof } from '../types/account';
import type { CashuSendSwap } from '../types/cashu';
import type { Money } from '../types/money';

/** Per-call query options (an abort signal, matching master). */
type Options = { abortSignal?: AbortSignal };

/**
 * A row of the `wallet.cashu_send_swaps` table (hand-written; master = generated types). Only
 * the columns `toSwap` reads are typed.
 */
export type AgicashDbCashuSendSwap = {
  id: string;
  account_id: string;
  user_id: string;
  transaction_id: string;
  encrypted_data: string;
  requires_input_proofs_swap: boolean;
  keyset_id?: string | null;
  keyset_counter?: number | null;
  token_hash: string;
  created_at: string;
  version: number;
  state: CashuSendSwap['state'];
  failure_reason?: string | null;
};

/** Params for {@link CashuSendSwapRepository.create} (master `CreateSendSwap`). */
export type CreateCashuSendSwap = {
  accountId: string;
  userId: string;
  tokenMintUrl: string;
  amountRequested: Money;
  amountToSend: Money;
  totalAmount: Money;
  cashuSendFee: Money;
  cashuReceiveFee: Money;
  inputProofs: CashuProof[];
  inputAmount: Money;
  tokenHash?: string;
  keysetId?: string;
  outputAmounts?: { send: number[]; change: number[] };
};

/** Reads + writes for the `wallet.cashu_send_swaps` table (RLS-scoped). */
export class CashuSendSwapRepository {
  constructor(
    private readonly db: WalletSupabaseClient,
    private readonly encryption: Encryption,
  ) {}

  /**
   * Create a token-send swap (RPC `create_cashu_send_swap`). The RPC reserves the input proofs
   * atomically and raises `CONCURRENCY_ERROR` on a stale read.
   */
  async create(
    params: CreateCashuSendSwap,
    options?: Options,
  ): Promise<CashuSendSwap> {
    const requiresInputProofsSwap = !params.inputAmount.equals(
      params.amountToSend,
    );

    const dataToEncrypt = CashuSwapSendDbDataSchema.parse({
      tokenMintUrl: params.tokenMintUrl,
      amountReceived: params.amountRequested,
      amountToSend: params.amountToSend,
      cashuReceiveFee: params.cashuReceiveFee,
      cashuSendFee: params.cashuSendFee,
      amountSpent: params.totalAmount,
      amountReserved: params.inputAmount,
      totalFee: params.cashuSendFee.add(params.cashuReceiveFee),
      outputAmounts: params.outputAmounts
        ? {
            send: params.outputAmounts.send,
            change: params.outputAmounts.change,
          }
        : undefined,
    } satisfies z.input<typeof CashuSwapSendDbDataSchema>);

    const encryptedData = await this.encryption.encrypt(dataToEncrypt);

    const numberOfOutputs = requiresInputProofsSwap
      ? (params.outputAmounts?.send?.length ?? 0) +
        (params.outputAmounts?.change?.length ?? 0)
      : undefined;

    const { data, error } = await this.rpc(
      'create_cashu_send_swap',
      {
        p_user_id: params.userId,
        p_account_id: params.accountId,
        p_input_proofs: params.inputProofs.map((p) => p.id),
        p_currency: params.amountToSend.currency,
        p_encrypted_data: encryptedData,
        p_requires_input_proofs_swap: requiresInputProofsSwap,
        p_token_hash: params.tokenHash,
        p_keyset_id: params.keysetId,
        p_number_of_outputs: numberOfOutputs,
      },
      options,
    );

    if (error) {
      if (error.hint === 'CONCURRENCY_ERROR') {
        throw new ConcurrencyError(error.message, error.details);
      }
      throw new Error('Failed to create cashu send swap', { cause: error });
    }

    return this.toSwap({ ...data.swap, cashu_proofs: data.reserved_proofs });
  }

  /**
   * Commit the swapped proofs-to-send + change (RPC `commit_proofs_to_send`) — moves a DRAFT
   * swap toward PENDING by persisting the encrypted proofsToSend / change proofs.
   */
  async commitProofsToSend({
    swap,
    tokenHash,
    proofsToSend,
    changeProofs,
  }: {
    swap: CashuSendSwap;
    tokenHash: string;
    proofsToSend: Proof[];
    changeProofs: Proof[];
  }): Promise<void> {
    const allProofs = proofsToSend.concat(changeProofs);
    const proofDataToEncrypt = allProofs.flatMap((x) => [x.amount, x.secret]);
    const encryptedProofData =
      await this.encryption.encryptBatch(proofDataToEncrypt);

    const encryptedProofs = allProofs.map((x, index) => {
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
    const encryptedProofsToSend = encryptedProofs.slice(0, proofsToSend.length);
    const encryptedChangeProofs = encryptedProofs.slice(proofsToSend.length);

    const { error } = await this.rpc('commit_proofs_to_send', {
      p_swap_id: swap.id,
      p_proofs_to_send: encryptedProofsToSend,
      p_change_proofs: encryptedChangeProofs,
      p_token_hash: tokenHash,
    });

    if (error) {
      throw new Error('Failed to complete cashu send swap', { cause: error });
    }
  }

  /** Mark the swap COMPLETED (RPC `complete_cashu_send_swap`). */
  async complete(swapId: string): Promise<void> {
    const { error } = await this.rpc('complete_cashu_send_swap', {
      p_swap_id: swapId,
    });
    if (error) {
      throw new Error('Failed to complete cashu send swap', { cause: error });
    }
  }

  /** Fail the swap (RPC `fail_cashu_send_swap`), releasing the reserved proofs. */
  async fail({
    swapId,
    reason,
  }: {
    swapId: string;
    reason: string;
  }): Promise<void> {
    const { error } = await this.rpc('fail_cashu_send_swap', {
      p_swap_id: swapId,
      p_reason: reason,
    });
    if (error) {
      throw new Error('Failed to fail cashu send swap', { cause: error });
    }
  }

  /** Get the swap with the given id (joined with its proofs), or null. */
  async get(id: string, options?: Options): Promise<CashuSendSwap | null> {
    let query = this.db
      .from('cashu_send_swaps')
      .select('*, cashu_proofs!spending_cashu_send_swap_id(*)')
      .eq('id', id);
    if (options?.abortSignal) {
      query = query.abortSignal(options.abortSignal);
    }
    const { data, error } = await query.maybeSingle<CashuSendSwapRow>();
    if (error) {
      throw new Error('Failed to get cashu send swap', { cause: error });
    }
    return data ? this.toSwap(data) : null;
  }

  /**
   * Get all unresolved (DRAFT or PENDING) token-send swaps for the user. INTERNAL — feeds the
   * future orchestrator's resume sweep (the public interface has no `listPending`).
   */
  async getUnresolved(
    userId: string,
    options?: Options,
  ): Promise<CashuSendSwap[]> {
    let query = this.db
      .from('cashu_send_swaps')
      .select('*, cashu_proofs!spending_cashu_send_swap_id(*)')
      .eq('user_id', userId)
      .in('state', ['DRAFT', 'PENDING']);
    if (options?.abortSignal) {
      query = query.abortSignal(options.abortSignal);
    }
    const { data, error } = await query.returns<CashuSendSwapRow[]>();
    if (error) {
      throw new Error('Failed to get unresolved cashu send swaps', {
        cause: error,
      });
    }
    return Promise.all(data.map((d) => this.toSwap(d)));
  }

  /** Map a DB row (joined with its proofs) to the domain {@link CashuSendSwap}. */
  async toSwap(data: CashuSendSwapRow): Promise<CashuSendSwap> {
    const encryptedInputProofs = data.cashu_proofs.filter(
      (p) => p.cashu_send_swap_id !== data.id,
    );
    const encryptedProofsToSend = data.cashu_proofs.filter(
      (p) =>
        p.cashu_send_swap_id === data.id || !data.requires_input_proofs_swap,
    );
    const encryptedProofs = encryptedInputProofs.concat(encryptedProofsToSend);
    const proofsDataToDecrypt = encryptedProofs.flatMap((x) => [
      x.amount,
      x.secret,
    ]);

    const [decryptedData, ...decryptedProofsData] =
      await this.encryption.decryptBatch([
        data.encrypted_data,
        ...proofsDataToDecrypt,
      ]);

    const decryptedProofs = toDecryptedCashuProofs(
      encryptedProofs,
      decryptedProofsData,
    );
    const inputProofs = decryptedProofs.slice(0, encryptedInputProofs.length);
    const proofsToSend = decryptedProofs.slice(encryptedInputProofs.length);

    const sendData = CashuSwapSendDbDataSchema.parse(decryptedData);

    return CashuSendSwapSchema.parse({
      id: data.id,
      accountId: data.account_id,
      userId: data.user_id,
      transactionId: data.transaction_id,
      amountReceived: sendData.amountReceived,
      amountToSend: sendData.amountToSend,
      amountSpent: sendData.amountSpent,
      cashuReceiveFee: sendData.cashuReceiveFee,
      cashuSendFee: sendData.cashuSendFee,
      inputProofs,
      inputAmount: sendData.amountReserved,
      totalFee: sendData.totalFee,
      version: data.version,
      state: data.state,
      // NOTE: a Date, not an ISO string (master verbatim).
      createdAt: new Date(data.created_at),
      outputAmounts: sendData.outputAmounts
        ? sendData.outputAmounts
        : undefined,
      keysetId: data.keyset_id ?? undefined,
      keysetCounter: data.keyset_counter ?? undefined,
      tokenHash: data.token_hash,
      proofsToSend,
      failureReason: data.failure_reason ?? undefined,
    }) as CashuSendSwap;
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

/** A `cashu_send_swaps` row joined with its `cashu_proofs` (input + send proofs). */
type CashuSendSwapRow = AgicashDbCashuSendSwap & {
  cashu_proofs: (AgicashDbCashuProof & {
    cashu_send_swap_id?: string | null;
  })[];
};
