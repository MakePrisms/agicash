/**
 * Internal `wallet.cashu_receive_swaps` repository — Slice 3 / PR5b (same-mint token claim).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/receive/cashu-receive-swap-repository.ts`. Same re-housing as
 * the other repos; the account-returning RPCs (`create_cashu_receive_swap` /
 * `complete_cashu_receive_swap`) take an injected {@link AccountMapper}. The DB unique
 * constraint on the token hash (a duplicate claim, `23505`) surfaces as
 * {@link UniqueConstraintError}.
 *
 * The receive-SWAP domain type ({@link CashuReceiveSwap}) is INTERNAL — it is the same-mint
 * token-claim working object the (future) orchestrator drives + the {@link reverse} target;
 * the PUBLIC `receiveToken` result is a `CashuReceiveQuote` (§5). Typed here as the
 * `z.infer` of the re-housed `CashuReceiveSwapSchema`.
 *
 * @module
 */
import type { Proof, Token } from '@cashu/cashu-ts';
import type { z } from 'zod/mini';
import type { AgicashDbAccountWithProofs } from './db-account';
import {
  CashuReceiveSwapSchema,
  CashuSwapReceiveDbDataSchema,
  getTokenHash,
  proofToY,
} from './lib-cashu-quotes';
import type { WalletSupabaseClient } from './supabase-client';
import { UniqueConstraintError } from '../errors';
import type { Encryption } from './encryption';
import type { CashuAccount } from '../types/account';
import type { Money } from '../types/money';

/** Per-call query options (an abort signal, matching master). */
type Options = { abortSignal?: AbortSignal };

/** The INTERNAL cashu receive-swap domain type (`z.infer` of the re-housed schema). */
export type CashuReceiveSwap = z.infer<typeof CashuReceiveSwapSchema>;

/** Maps a returned account row (joined with proofs) to the domain {@link CashuAccount}. */
export type AccountMapper = (
  row: AgicashDbAccountWithProofs,
) => Promise<CashuAccount>;

/**
 * A row of the `wallet.cashu_receive_swaps` table (hand-written; master = generated types).
 * Only the columns `toReceiveSwap` reads are typed.
 */
export type AgicashDbCashuReceiveSwap = {
  token_hash: string;
  user_id: string;
  account_id: string;
  transaction_id: string;
  encrypted_data: string;
  keyset_id: string;
  keyset_counter: number;
  created_at: string;
  version: number;
  state: CashuReceiveSwap['state'];
  failure_reason?: string | null;
};

/** Params for {@link CashuReceiveSwapRepository.create} (master `CreateReceiveSwap`). */
export type CreateCashuReceiveSwap = {
  userId: string;
  accountId: string;
  keysetId: string;
  inputAmount: Money;
  cashuReceiveFee: Money;
  receiveAmount: Money;
  outputAmounts: number[];
  token: Token;
  reversedTransactionId?: string;
};

/** Reads + writes for the `wallet.cashu_receive_swaps` table (RLS-scoped). */
export class CashuReceiveSwapRepository {
  constructor(
    private readonly db: WalletSupabaseClient,
    private readonly encryption: Encryption,
    private readonly mapAccount: AccountMapper,
  ) {}

  /**
   * Create a same-mint receive swap (RPC `create_cashu_receive_swap`) + bump the account keyset
   * counter. Raises {@link UniqueConstraintError} when the token has already been claimed.
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
    }: CreateCashuReceiveSwap,
    options?: Options,
  ): Promise<{ swap: CashuReceiveSwap; account: CashuAccount }> {
    const currency = inputAmount.currency;
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

    const encryptedData = await this.encryption.encrypt(receiveData);

    const { data, error } = await this.rpc(
      'create_cashu_receive_swap',
      {
        p_token_hash: tokenHash,
        p_account_id: accountId,
        p_user_id: userId,
        p_currency: currency,
        p_keyset_id: keysetId,
        p_number_of_outputs: outputAmounts.length,
        p_encrypted_data: encryptedData,
        p_reversed_transaction_id: reversedTransactionId,
      },
      options,
    );

    if (error) {
      if (error.code === '23505') {
        throw new UniqueConstraintError(
          'This token has already been claimed',
          'TOKEN_ALREADY_CLAIMED',
        );
      }
      throw new Error('Failed to create receive swap', { cause: error });
    }

    const [swap, account] = await Promise.all([
      this.toReceiveSwap(data.swap),
      this.mapAccount(data.account),
    ]);
    return { swap, account };
  }

  /**
   * Complete the token claim (RPC `complete_cashu_receive_swap`): stores the new proofs + marks
   * the swap COMPLETED. Returns the updated swap + account + added proof ids.
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
      'complete_cashu_receive_swap',
      { p_token_hash: tokenHash, p_user_id: userId, p_proofs: encryptedProofs },
      options,
    );

    if (error) {
      throw new Error('Failed to complete token claim', { cause: error });
    }
    if (!data) {
      throw new Error('No data returned from complete_cashu_receive_swap');
    }

    const [swap, account] = await Promise.all([
      this.toReceiveSwap(data.swap),
      this.mapAccount(data.account),
    ]);
    return {
      swap,
      account,
      addedProofs: data.added_proofs.map((x: { id: string }) => x.id),
    };
  }

  /** Fail the receive swap (RPC `fail_cashu_receive_swap`). */
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
    const { data, error } = await this.rpc(
      'fail_cashu_receive_swap',
      { p_token_hash: tokenHash, p_user_id: userId, p_failure_reason: reason },
      options,
    );
    if (error) {
      throw new Error('Failed to fail receive swap', { cause: error });
    }
    return this.toReceiveSwap(data);
  }

  /**
   * Get all pending receive swaps for the user. INTERNAL — feeds the future orchestrator's
   * resume sweep (the public interface has no `listPending`).
   */
  async getPending(
    userId: string,
    options?: Options,
  ): Promise<CashuReceiveSwap[]> {
    let query = this.db
      .from('cashu_receive_swaps')
      .select()
      .match({ user_id: userId, state: 'PENDING' });
    if (options?.abortSignal) {
      query = query.abortSignal(options.abortSignal);
    }
    const { data, error } = await query.returns<AgicashDbCashuReceiveSwap[]>();
    if (error) {
      throw new Error('Failed to get pending receive swaps', { cause: error });
    }
    return Promise.all(data.map((item) => this.toReceiveSwap(item)));
  }

  /** Map a DB row to the internal {@link CashuReceiveSwap}. */
  async toReceiveSwap(
    data: AgicashDbCashuReceiveSwap,
  ): Promise<CashuReceiveSwap> {
    const decryptedData = await this.encryption.decrypt(data.encrypted_data);
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
