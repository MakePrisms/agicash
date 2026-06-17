import type { Money } from '@agicash/money';
import { Money as MoneyClass } from '@agicash/money';
import type { Proof } from '@cashu/cashu-ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod/mini';
import { ConcurrencyError } from '../../errors';
import type { CashuProof } from '../../types/account';
import type { CashuSendSwap } from '../../types/cashu';
import { classify } from '../classify';
import type { EncryptionService } from '../crypto/encryption';
import {
  toDecryptedCashuProofs,
  toEncryptedProofData,
} from '../db/cashu-proofs';
import { CashuSwapSendDbDataSchema } from '../db/cashu-send-swap-db-data';
import type {
  AgicashDbCashuProof,
  AgicashDbCashuSendSwap,
  Database,
} from '../db/database';

// ---------------------------------------------------------------------------
// CashuSendSwapSchema — ported from app/features/send/cashu-send-swap.ts.
// NOTE: createdAt is z.date() (a Date, not an ISO string).
// CashuProof elements use z.custom<CashuProof>() — the structured proof fields
// are already validated by toDecryptedCashuProofs; re-defining them here would
// require duplicating ProofSchema's dleq/witness handling.
// ---------------------------------------------------------------------------

const CashuSendSwapBaseSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  userId: z.string(),
  inputProofs: z.array(z.custom<CashuProof>()),
  keysetId: z.optional(z.string()),
  keysetCounter: z.optional(z.number()),
  outputAmounts: z.optional(
    z.object({
      send: z.array(z.number()),
      change: z.array(z.number()),
    }),
  ),
  inputAmount: z.instanceof(MoneyClass),
  amountReceived: z.instanceof(MoneyClass),
  cashuReceiveFee: z.instanceof(MoneyClass),
  amountToSend: z.instanceof(MoneyClass),
  cashuSendFee: z.instanceof(MoneyClass),
  amountSpent: z.instanceof(MoneyClass),
  totalFee: z.instanceof(MoneyClass),
  transactionId: z.string(),
  createdAt: z.date(),
  version: z.number(),
});

const CashuSendSwapDraftStateSchema = z.object({
  state: z.literal('DRAFT'),
  keysetId: z.string(),
  keysetCounter: z.number(),
  outputAmounts: z.object({
    send: z.array(z.number()),
    change: z.array(z.number()),
  }),
});

const CashuSendSwapPendingCompletedStateSchema = z.object({
  state: z.enum(['PENDING', 'COMPLETED']),
  tokenHash: z.string(),
  proofsToSend: z.array(z.custom<CashuProof>()),
});

const CashuSendSwapFailedStateSchema = z.object({
  state: z.literal('FAILED'),
  failureReason: z.string(),
});

const CashuSendSwapReversedStateSchema = z.object({
  state: z.literal('REVERSED'),
});

const CashuSendSwapSchema = z.intersection(
  CashuSendSwapBaseSchema,
  z.union([
    CashuSendSwapDraftStateSchema,
    CashuSendSwapPendingCompletedStateSchema,
    CashuSendSwapFailedStateSchema,
    CashuSendSwapReversedStateSchema,
  ]),
);

// Compile-time check: schema output must be assignable to the contract type.
type _SchemaFitsContract = z.infer<
  typeof CashuSendSwapSchema
> extends CashuSendSwap
  ? true
  : never;
const _check: _SchemaFitsContract = true;
void _check;

// ---------------------------------------------------------------------------
// Public input type + repository
// ---------------------------------------------------------------------------

export type CreateSendSwap = {
  /** The id of the account to send from. */
  accountId: string;
  /** The id of the user creating the swap. */
  userId: string;
  /** The URL of the mint creating the token. */
  tokenMintUrl: string;
  /**
   * The requested amount to send in the account's currency.
   * This is the amount that the sender wants the receiver to receive.
   */
  amountRequested: Money;
  /**
   * The full amount to send including the receive fee in the account's currency.
   * This is `amountRequested` plus `cashuReceiveFee`.
   */
  amountToSend: Money;
  /**
   * The total amount spent for this send.
   * This is the sum of `amountToSend` and `cashuSendFee`.
   */
  totalAmount: Money;
  /** The fee for the swap in the account's currency. */
  cashuSendFee: Money;
  /** The fee for the swap in the account's currency. */
  cashuReceiveFee: Money;
  /**
   * The proofs being spent as inputs.
   * The sum of these might be greater than amountToSend, in which case we will need to swap.
   */
  inputProofs: CashuProof[];
  /** The sum of the input proofs in the account's currency. */
  inputAmount: Money;
  /**
   * The hash of the token being sent.
   * Should be set only when send swap is not needed (sum of input proofs is equal to amount to send).
   */
  tokenHash?: string;
  /**
   * The keyset id that was used to create the output data.
   * Should be set only when send swap is needed (sum of input proofs is greater than amount to send).
   */
  keysetId?: string;
  /**
   * The output data to use for performing the swap.
   * Should be set only when send swap is needed.
   */
  outputAmounts?: {
    send: number[];
    change: number[];
  };
};

type Options = { abortSignal?: AbortSignal };

/** Data access for `wallet.cashu_send_swaps` (+ `cashu_proofs`). */
export class CashuSendSwapRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Creates a cashu send swap.
   * @returns Created cashu send swap.
   * @throws {ConcurrencyError} on optimistic-lock conflicts.
   */
  async create(
    {
      accountId,
      userId,
      tokenMintUrl,
      amountRequested,
      amountToSend,
      totalAmount,
      cashuSendFee,
      cashuReceiveFee,
      inputProofs,
      inputAmount,
      tokenHash,
      keysetId,
      outputAmounts,
    }: CreateSendSwap,
    options?: Options,
  ): Promise<CashuSendSwap> {
    const requiresInputProofsSwap = !inputAmount.equals(amountToSend);

    const dataToEncrypt = CashuSwapSendDbDataSchema.parse({
      tokenMintUrl,
      amountReceived: amountRequested,
      amountToSend,
      cashuReceiveFee,
      cashuSendFee,
      amountSpent: totalAmount,
      amountReserved: inputAmount,
      totalFee: cashuSendFee.add(cashuReceiveFee),
      outputAmounts: outputAmounts
        ? { send: outputAmounts.send, change: outputAmounts.change }
        : undefined,
    });

    const encryption = await this.encryption.get();
    const encryptedData = await encryption.encrypt(dataToEncrypt);

    const numberOfOutputs = requiresInputProofsSwap
      ? (outputAmounts?.send?.length ?? 0) +
        (outputAmounts?.change?.length ?? 0)
      : undefined;

    const query = this.db.rpc('create_cashu_send_swap', {
      p_user_id: userId,
      p_account_id: accountId,
      p_input_proofs: inputProofs.map((p) => p.id),
      p_currency: amountToSend.currency,
      p_encrypted_data: encryptedData,
      p_requires_input_proofs_swap: requiresInputProofsSwap,
      p_token_hash: tokenHash,
      p_keyset_id: keysetId,
      p_number_of_outputs: numberOfOutputs,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      if (error.hint === 'CONCURRENCY_ERROR') {
        throw new ConcurrencyError(
          error.message,
          error.details ?? 'concurrency',
        );
      }
      throw classify(error);
    }

    return this.toSwap({
      ...data.swap,
      cashu_proofs: data.reserved_proofs,
    });
  }

  /**
   * Commits the proofs-to-send and change proofs after the swap is performed.
   * @throws if the RPC fails.
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
    const encryption = await this.encryption.get();
    const [encryptedProofsToSend, encryptedChangeProofs] = await Promise.all([
      toEncryptedProofData(proofsToSend, encryption),
      toEncryptedProofData(changeProofs, encryption),
    ]);

    const query = this.db.rpc('commit_proofs_to_send', {
      p_swap_id: swap.id,
      p_proofs_to_send: encryptedProofsToSend,
      p_change_proofs: encryptedChangeProofs,
      p_token_hash: tokenHash,
    });

    const { error } = await query;

    if (error) {
      throw classify(error);
    }
  }

  /**
   * Completes the cashu send swap (state → COMPLETED).
   * @throws if the RPC fails.
   */
  async complete(swapId: string): Promise<void> {
    const query = this.db.rpc('complete_cashu_send_swap', {
      p_swap_id: swapId,
    });

    const { error } = await query;

    if (error) {
      throw classify(error);
    }
  }

  /**
   * Fails the cashu send swap (state → FAILED).
   * @throws if the RPC fails.
   */
  async fail({
    swapId,
    reason,
  }: {
    swapId: string;
    reason: string;
  }): Promise<void> {
    const query = this.db.rpc('fail_cashu_send_swap', {
      p_swap_id: swapId,
      p_reason: reason,
    });

    const { error } = await query;

    if (error) {
      throw classify(error);
    }
  }

  /**
   * Gets all unresolved (DRAFT or PENDING) cashu send swaps for the given user.
   * @returns Unresolved cashu send swaps.
   */
  async getUnresolved(
    userId: string,
    options?: Options,
  ): Promise<CashuSendSwap[]> {
    const q = this.db
      .from('cashu_send_swaps')
      .select('*, cashu_proofs!spending_cashu_send_swap_id(*)')
      .eq('user_id', userId)
      .in('state', ['DRAFT', 'PENDING']);
    if (options?.abortSignal) q.abortSignal(options.abortSignal);

    const { data, error } = await q;

    if (error) {
      throw classify(error);
    }

    return Promise.all((data ?? []).map((x) => this.toSwap(x)));
  }

  /**
   * Gets the cashu send swap with the given id.
   * @returns The cashu send swap, or null if not found.
   */
  async get(id: string, options?: Options): Promise<CashuSendSwap | null> {
    const q = this.db
      .from('cashu_send_swaps')
      .select('*, cashu_proofs!spending_cashu_send_swap_id(*)')
      .eq('id', id);
    if (options?.abortSignal) q.abortSignal(options.abortSignal);

    const { data, error } = await q.maybeSingle();

    if (error) {
      throw classify(error);
    }

    return data ? this.toSwap(data) : null;
  }

  /**
   * Gets the cashu send swap with the given transaction id.
   * @returns The cashu send swap, or null if not found.
   */
  async getByTransactionId(
    transactionId: string,
    options?: Options,
  ): Promise<CashuSendSwap | null> {
    const q = this.db
      .from('cashu_send_swaps')
      .select('*, cashu_proofs!spending_cashu_send_swap_id(*)')
      .eq('transaction_id', transactionId);
    if (options?.abortSignal) q.abortSignal(options.abortSignal);

    const { data, error } = await q.maybeSingle();

    if (error) {
      throw classify(error);
    }

    return data ? this.toSwap(data) : null;
  }

  private async toSwap(
    data: AgicashDbCashuSendSwap & { cashu_proofs: AgicashDbCashuProof[] },
  ): Promise<CashuSendSwap> {
    // Input proofs are those reserved for the swap (cashu_send_swap_id = swap id).
    // Proofs-to-send are those being spent out (spending_cashu_send_swap_id = swap id,
    // i.e. cashu_send_swap_id !== swap id). When no swap is needed (requires_input_proofs_swap
    // is false), the input proofs ARE the proofs-to-send so all proofs belong to the
    // proofsToSend bucket.
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

    const encryption = await this.encryption.get();
    const [decryptedData, ...decryptedProofsData] =
      await encryption.decryptBatch([
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
      createdAt: new Date(data.created_at),
      outputAmounts: sendData.outputAmounts ?? undefined,
      keysetId: data.keyset_id ?? undefined,
      keysetCounter: data.keyset_counter ?? undefined,
      tokenHash: data.token_hash,
      proofsToSend,
      failureReason: data.failure_reason ?? undefined,
    });
  }
}
