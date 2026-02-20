import type { Proof, Token } from '@cashu/cashu-ts';
import type z from 'zod';
import type { AgicashDb, AgicashDbCashuReceiveSwap } from '../../db/database';
import { CashuSwapReceiveDbDataSchema } from '../../db/json-models';
import { proofToY } from '../../lib/cashu';
import type { Money } from '../../lib/money';
import type { AllUnionFieldsRequired } from '../../lib/type-utils';
import type { CashuAccount } from '../accounts/account';
import type { AccountRepository } from '../accounts/account-repository';
import { getTokenHash } from '../shared/cashu';
import type { Encryption } from '../shared/encryption';
import { UniqueConstraintError } from '../shared/error';
import {
  type CashuReceiveSwap,
  CashuReceiveSwapSchema,
} from './cashu-receive-swap';

type Options = {
  abortSignal?: AbortSignal;
};

type CreateReceiveSwap = {
  /**
   * ID of the receiving user.
   */
  userId: string;
  /**
   * ID of the receiving account.
   */
  accountId: string;
  /**
   * Keyset ID.
   */
  keysetId: string;
  /**
   * The sum of the proofs being claimed.
   */
  inputAmount: Money;
  /**
   * The amount of the fee in the unit of the token.
   */
  cashuReceiveFee: Money;
  /**
   * Amount that will actually be received after the mint's fees are deducted.
   */
  receiveAmount: Money;
  /**
   * Output amounts.
   */
  outputAmounts: number[];
  /**
   * Cashu token being claimed
   */
  token: Token;
  /**
   * ID of the transaction that this swap is reversing.
   */
  reversedTransactionId?: string;
};

export class CashuReceiveSwapRepository {
  constructor(
    private readonly db: AgicashDb,
    private readonly encryption: Encryption,
    private readonly accountRepository: AccountRepository,
  ) {}

  /**
   * Creates a cashu receive swap and updates the account keyset counter.
   * @returns Created cashu receive swap.
   * @throws Error if a receive swap with the same token hash already exists.
   * @throws Error if outputAmounts is invalid.
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
  ): Promise<{
    swap: CashuReceiveSwap;
    account: CashuAccount;
  }> {
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

    const query = this.db.rpc('create_cashu_receive_swap', {
      p_token_hash: tokenHash,
      p_account_id: accountId,
      p_user_id: userId,
      p_currency: currency,
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
        throw new UniqueConstraintError('This token has already been claimed');
      }
      throw new Error('Failed to create receive swap', { cause: error });
    }

    const [swap, account] = await Promise.all([
      this.toReceiveSwap(data.swap),
      this.accountRepository.toAccount<CashuAccount>(data.account),
    ]);

    return {
      swap,
      account,
    };
  }

  /**
   * Completes the token claiming process.
   * Updates the account with new proofs and sets the state to COMPLETED.
   */
  async completeReceiveSwap(
    {
      tokenHash,
      userId,
      proofs,
    }: {
      /**
       * Hash of the token that was claimed.
       */
      tokenHash: string;
      /**
       * ID of the user that is completing the receive swap.
       */
      userId: string;
      /**
       * New proofs to be stored in the account.
       */
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
      const encryptedDataIndex = index * 2;
      return {
        keysetId: x.id,
        amount: encryptedData[encryptedDataIndex],
        secret: encryptedData[encryptedDataIndex + 1],
        unblindedSignature: x.C,
        publicKeyY: proofToY(x),
        dleq: x.dleq ?? null,
        witness: x.witness ?? null,
      };
    });

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
      throw new Error('Failed to complete token claim', error);
    }

    if (!data) {
      throw new Error('No data returned from complete_cashu_receive_swap');
    }

    const [swap, account] = await Promise.all([
      this.toReceiveSwap(data.swap),
      this.accountRepository.toAccount<CashuAccount>(data.account),
    ]);

    return {
      swap,
      account,
      addedProofs: data.added_proofs.map((x) => x.id),
    };
  }

  /**
   * Updates the state of a receive swap to FAILED.
   */
  async fail(
    {
      tokenHash,
      userId,
      reason,
    }: {
      /**
       * Hash of the token to be failed.
       */
      tokenHash: string;
      /**
       * ID of the user that is failing the receive swap.
       */
      userId: string;
      /**
       * Reason for the failure.
       */
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
      throw new Error('Failed to fail receive swap', { cause: error });
    }

    return this.toReceiveSwap(data);
  }

  async getByTransactionId(
    transactionId: string,
    options?: Options,
  ): Promise<CashuReceiveSwap | null> {
    const query = this.db
      .from('cashu_receive_swaps')
      .select()
      .eq('transaction_id', transactionId);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to get cashu receive swap by transaction id', {
        cause: error,
      });
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
    const query = this.db.from('cashu_receive_swaps').select().match({
      user_id: userId,
      state: 'PENDING',
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to get pending receive swaps', { cause: error });
    }

    return Promise.all(data.map((item) => this.toReceiveSwap(item)));
  }

  async toReceiveSwap(
    data: AgicashDbCashuReceiveSwap,
  ): Promise<CashuReceiveSwap> {
    const decryptedData = await this.encryption.decrypt(data.encrypted_data);
    const receiveData = CashuSwapReceiveDbDataSchema.parse(decryptedData);

    // `satisfies AllUnionFieldsRequired` gives compile time safety and makes sure that all fields are present and of the correct type.
    // schema parse then is doing cashu receive swap invariant check at runtime. For example it makes sure that failureReason is present when state is FAILED.
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
    } satisfies AllUnionFieldsRequired<
      z.output<typeof CashuReceiveSwapSchema>
    >);
  }
}
