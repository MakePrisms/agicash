import { Money } from '@agicash/money';
import type { Proof, Token } from '@cashu/cashu-ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod/mini';
import { DomainError } from '../../errors';
import type { CashuAccount } from '../../types/account';
import type { CashuReceiveSwap } from '../../types/cashu';
import { classify } from '../classify';
import type { EncryptionService } from '../crypto/encryption';
import { toEncryptedProofData } from '../db/cashu-proofs';
import { CashuSwapReceiveDbDataSchema } from '../db/cashu-receive-swap-db-data';
import type { AgicashDbCashuReceiveSwap, Database } from '../db/database';
import { ProofSchema, getTokenHash } from '../lib/cashu';
import type { AccountRepository } from './account-repository';

// ---------------------------------------------------------------------------
// CashuReceiveSwapSchema — ported from app/features/receive/cashu-receive-swap.ts.
// The public type lives in src/types/cashu.ts; the conformance check below
// ensures the schema output matches it exactly (bidirectional extends).
// ---------------------------------------------------------------------------

const CashuReceiveSwapBaseSchema = z.object({
  tokenHash: z.string(),
  tokenProofs: z.array(ProofSchema),
  tokenDescription: z.optional(z.string()),
  userId: z.string(),
  accountId: z.string(),
  inputAmount: z.instanceof(Money),
  amountReceived: z.instanceof(Money),
  feeAmount: z.instanceof(Money),
  keysetId: z.string(),
  keysetCounter: z.number(),
  outputAmounts: z.array(z.number()),
  transactionId: z.string(),
  createdAt: z.string(),
  version: z.number(),
});

const CashuReceiveSwapPendingStateSchema = z.object({
  state: z.literal('PENDING'),
});

const CashuReceiveSwapCompletedStateSchema = z.object({
  state: z.literal('COMPLETED'),
});

const CashuReceiveSwapFailedStateSchema = z.object({
  state: z.literal('FAILED'),
  failureReason: z.string(),
});

export const CashuReceiveSwapSchema = z.intersection(
  CashuReceiveSwapBaseSchema,
  z.union([
    CashuReceiveSwapPendingStateSchema,
    CashuReceiveSwapCompletedStateSchema,
    CashuReceiveSwapFailedStateSchema,
  ]),
);

// Re-export from the public contract so internal consumers keep working.
export type { CashuReceiveSwap };

// Bidirectional compile-time check: schema output ↔ public contract type.
type _SchemaFitsContract = z.infer<typeof CashuReceiveSwapSchema> extends CashuReceiveSwap
  ? CashuReceiveSwap extends z.infer<typeof CashuReceiveSwapSchema>
    ? true
    : never
  : never;
const _schemaFitsContract: _SchemaFitsContract = true;
void _schemaFitsContract;

// ---------------------------------------------------------------------------
// Public input type + repository
// ---------------------------------------------------------------------------

export type CreateReceiveSwap = {
  /** The cashu token being claimed. */
  token: Token;
  /** ID of the receiving user. */
  userId: string;
  /** ID of the receiving account. */
  accountId: string;
  /** Keyset ID. */
  keysetId: string;
  /** The sum of the proofs being claimed. */
  inputAmount: Money;
  /** The amount of the fee in the unit of the token. */
  cashuReceiveFee: Money;
  /** Amount that will actually be received after the mint's fees are deducted. */
  receiveAmount: Money;
  /** Output amounts. */
  outputAmounts: number[];
  /** ID of the transaction that this swap is reversing. */
  reversedTransactionId?: string;
};

type Options = { abortSignal?: AbortSignal };

/** Data access for `wallet.cashu_receive_swaps`. */
export class CashuReceiveSwapRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly encryption: EncryptionService,
    private readonly accountRepository: AccountRepository,
  ) {}

  /**
   * Creates a cashu receive swap and updates the account keyset counter.
   * @returns Created cashu receive swap and updated account.
   * @throws {DomainError} with code 'token_already_claimed' if a swap for this token already exists.
   */
  async create(
    {
      token,
      userId,
      accountId,
      keysetId,
      inputAmount,
      cashuReceiveFee,
      receiveAmount,
      outputAmounts,
      reversedTransactionId,
    }: CreateReceiveSwap,
    options?: Options,
  ): Promise<{ swap: CashuReceiveSwap; account: CashuAccount }> {
    const tokenHash = await getTokenHash(token);

    const receiveData = CashuSwapReceiveDbDataSchema.parse({
      tokenMintUrl: token.mint,
      tokenAmount: inputAmount,
      tokenProofs: token.proofs,
      tokenDescription: token.memo,
      amountReceived: receiveAmount,
      outputAmounts,
      cashuReceiveFee,
    } satisfies z.input<typeof CashuSwapReceiveDbDataSchema>);

    const encryption = await this.encryption.get();
    const encryptedData = await encryption.encrypt(receiveData);

    const query = this.db.rpc('create_cashu_receive_swap', {
      p_token_hash: tokenHash,
      p_account_id: accountId,
      p_user_id: userId,
      p_currency: inputAmount.currency,
      p_keyset_id: keysetId,
      p_number_of_outputs: outputAmounts.length,
      p_encrypted_data: encryptedData,
      p_reversed_transaction_id: reversedTransactionId,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      if (error.code === '23505') {
        throw new DomainError(
          'This token has already been claimed',
          'token_already_claimed',
        );
      }
      throw classify(error);
    }

    const [swap, account] = await Promise.all([
      this.toReceiveSwap(data.swap),
      this.accountRepository.toAccount(data.account) as Promise<CashuAccount>,
    ]);

    return { swap, account };
  }

  /**
   * Completes the token claiming process.
   * Updates the account with new proofs and sets the state to COMPLETED.
   * @returns Updated swap, account, and a list of added proof ids.
   */
  async completeReceiveSwap(
    {
      tokenHash,
      userId,
      proofs,
    }: {
      tokenHash: string;
      userId: string;
      proofs: Proof[];
    },
    options?: Options,
  ): Promise<{
    swap: CashuReceiveSwap;
    account: CashuAccount;
    addedProofs: string[];
  }> {
    const encryption = await this.encryption.get();
    const encryptedProofs = await toEncryptedProofData(proofs, encryption);

    const query = this.db.rpc('complete_cashu_receive_swap', {
      p_token_hash: tokenHash,
      p_user_id: userId,
      p_proofs: encryptedProofs,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw classify(error);
    }

    const [swap, account] = await Promise.all([
      this.toReceiveSwap(data.swap),
      this.accountRepository.toAccount(data.account) as Promise<CashuAccount>,
    ]);

    return {
      swap,
      account,
      addedProofs: data.added_proofs.map((x) => x.id),
    };
  }

  /**
   * Updates the state of a receive swap to FAILED.
   * @returns The updated receive swap.
   */
  async fail(
    {
      tokenHash,
      userId,
      reason,
    }: {
      tokenHash: string;
      userId: string;
      reason: string;
    },
    options?: Options,
  ): Promise<CashuReceiveSwap> {
    const query = this.db.rpc('fail_cashu_receive_swap', {
      p_token_hash: tokenHash,
      p_user_id: userId,
      p_failure_reason: reason,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw classify(error);
    }

    return this.toReceiveSwap(data);
  }

  /**
   * Gets the cashu receive swap with the given transaction id.
   * @returns The cashu receive swap, or null if not found.
   */
  async getByTransactionId(
    transactionId: string,
    options?: Options,
  ): Promise<CashuReceiveSwap | null> {
    const q = this.db
      .from('cashu_receive_swaps')
      .select()
      .eq('transaction_id', transactionId);

    if (options?.abortSignal) {
      q.abortSignal(options.abortSignal);
    }

    const { data, error } = await q.maybeSingle();

    if (error) {
      throw classify(error);
    }

    return data ? this.toReceiveSwap(data) : null;
  }

  /**
   * Gets all pending receive swaps for a given user.
   * @returns All receive swaps in a PENDING state for the given user.
   */
  async getPending(
    userId: string,
    options?: Options,
  ): Promise<CashuReceiveSwap[]> {
    const q = this.db
      .from('cashu_receive_swaps')
      .select()
      .eq('user_id', userId)
      .eq('state', 'PENDING');

    if (options?.abortSignal) {
      q.abortSignal(options.abortSignal);
    }

    const { data, error } = await q;

    if (error) {
      throw classify(error);
    }

    return Promise.all((data ?? []).map((item) => this.toReceiveSwap(item)));
  }

  async toReceiveSwap(
    data: AgicashDbCashuReceiveSwap,
  ): Promise<CashuReceiveSwap> {
    const encryption = await this.encryption.get();
    const decryptedData = await encryption.decrypt(data.encrypted_data);
    const receiveData = CashuSwapReceiveDbDataSchema.parse(decryptedData);

    return CashuReceiveSwapSchema.parse({
      tokenHash: data.token_hash,
      tokenProofs: receiveData.tokenProofs,
      tokenDescription: receiveData.tokenDescription,
      userId: data.user_id,
      accountId: data.account_id,
      inputAmount: receiveData.tokenAmount,
      amountReceived: receiveData.amountReceived,
      feeAmount: receiveData.cashuReceiveFee,
      keysetId: data.keyset_id,
      keysetCounter: data.keyset_counter,
      outputAmounts: receiveData.outputAmounts,
      transactionId: data.transaction_id,
      version: data.version,
      createdAt: data.created_at,
      state: data.state,
      failureReason: data.failure_reason ?? undefined,
    });
  }
}
