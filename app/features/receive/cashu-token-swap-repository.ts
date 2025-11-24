import type { Proof, Token } from '@cashu/cashu-ts';
import type { Json } from 'supabase/database.types';
import { proofToY } from '~/lib/cashu';
import { Money } from '~/lib/money';
import type { CashuAccount } from '../accounts/account';
import {
  type AccountRepository,
  useAccountRepository,
} from '../accounts/account-repository';
import {
  type AgicashDb,
  type AgicashDbCashuTokenSwap,
  agicashDb,
} from '../agicash-db/database';
import { getTokenHash } from '../shared/cashu';
import { getDefaultUnit } from '../shared/currencies';
import { type Encryption, useEncryption } from '../shared/encryption';
import { UniqueConstraintError } from '../shared/error';
import type { CashuTokenReceiveTransactionDetails } from '../transactions/transaction';
import type { CashuTokenSwap } from './cashu-token-swap';

type Options = {
  abortSignal?: AbortSignal;
};

type CreateTokenSwap = {
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

export class CashuTokenSwapRepository {
  constructor(
    private readonly db: AgicashDb,
    private readonly encryption: Encryption,
    private readonly accountRepository: AccountRepository,
  ) {}

  /**
   * Creates a cashu token swap and updates the account keyset counter.
   * @returns Created cashu token swap.
   * @throws Error if a token swap with the same token hash already exists.
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
    }: CreateTokenSwap,
    options?: Options,
  ): Promise<{
    swap: CashuTokenSwap;
    account: CashuAccount;
  }> {
    const currency = inputAmount.currency;
    const unit = getDefaultUnit(inputAmount.currency);
    const tokenHash = await getTokenHash(token);

    const details: CashuTokenReceiveTransactionDetails = {
      amountReceived: receiveAmount,
      cashuReceiveFee,
      totalFees: cashuReceiveFee,
      tokenAmount: inputAmount,
    };

    const [encryptedTransactionDetails, encryptedProofs] =
      await this.encryption.encryptBatch([details, token.proofs]);

    const query = this.db.rpc('create_cashu_token_swap', {
      p_token_hash: tokenHash,
      p_token_proofs: encryptedProofs,
      p_account_id: accountId,
      p_user_id: userId,
      p_currency: currency,
      p_unit: unit,
      p_keyset_id: keysetId,
      p_output_amounts: outputAmounts,
      p_input_amount: inputAmount.toNumber(unit),
      p_receive_amount: receiveAmount.toNumber(unit),
      p_fee_amount: cashuReceiveFee.toNumber(unit),
      p_reversed_transaction_id: reversedTransactionId,
      p_encrypted_transaction_details: encryptedTransactionDetails,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      if (error.code === '23505') {
        throw new UniqueConstraintError('This token has already been claimed');
      }
      throw new Error('Failed to create token swap', { cause: error });
    }

    const [swap, account] = await Promise.all([
      CashuTokenSwapRepository.toTokenSwap(data.swap, this.encryption.decrypt),
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
  async completeTokenSwap(
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
       * ID of the user that is completing the token swap.
       */
      userId: string;
      /**
       * New proofs to be stored in the account.
       */
      proofs: Proof[];
    },
    options?: Options,
  ): Promise<{
    swap: CashuTokenSwap;
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
        dleq: x.dleq as Json,
        witness: x.witness as Json,
      };
    });

    const query = this.db.rpc('complete_cashu_token_swap', {
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
      throw new Error('No data returned from complete_cashu_token_swap');
    }

    const [swap, account] = await Promise.all([
      CashuTokenSwapRepository.toTokenSwap(data.swap, this.encryption.decrypt),
      this.accountRepository.toAccount<CashuAccount>(data.account),
    ]);

    return {
      swap,
      account,
      addedProofs: data.added_proofs.map((x) => x.id),
    };
  }

  /**
   * Updates the state of a token swap to FAILED.
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
       * ID of the user that is failing the token swap.
       */
      userId: string;
      /**
       * Reason for the failure.
       */
      reason: string;
    },
    options?: Options,
  ): Promise<CashuTokenSwap> {
    const query = this.db.rpc('fail_cashu_token_swap', {
      p_token_hash: tokenHash,
      p_user_id: userId,
      p_failure_reason: reason,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to fail token swap', { cause: error });
    }

    return CashuTokenSwapRepository.toTokenSwap(data, this.encryption.decrypt);
  }

  async getByTransactionId(
    transactionId: string,
    options?: Options,
  ): Promise<CashuTokenSwap | null> {
    const query = this.db
      .from('cashu_token_swaps')
      .select()
      .eq('transaction_id', transactionId);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to get cashu token swap by transaction id', {
        cause: error,
      });
    }

    return data
      ? CashuTokenSwapRepository.toTokenSwap(data, this.encryption.decrypt)
      : null;
  }

  /**
   * Gets all pending token swaps for a given user.
   * @returns All token swaps in a PENDING state for the given user.
   */
  async getPending(
    userId: string,
    options?: Options,
  ): Promise<CashuTokenSwap[]> {
    const query = this.db.from('cashu_token_swaps').select().match({
      user_id: userId,
      state: 'PENDING',
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to get pending token swaps', { cause: error });
    }

    return Promise.all(
      data.map((item) =>
        CashuTokenSwapRepository.toTokenSwap(item, this.encryption.decrypt),
      ),
    );
  }

  static async toTokenSwap(
    data: AgicashDbCashuTokenSwap,
    decryptData: Encryption['decrypt'],
  ): Promise<CashuTokenSwap> {
    const decryptedProofs = await decryptData<Proof[]>(data.token_proofs);

    const commonData = {
      tokenHash: data.token_hash,
      tokenProofs: decryptedProofs,
      userId: data.user_id,
      accountId: data.account_id,
      inputAmount: new Money({
        amount: data.input_amount,
        currency: data.currency,
        unit: data.unit,
      }),
      receiveAmount: new Money({
        amount: data.receive_amount,
        currency: data.currency,
        unit: data.unit,
      }),
      feeAmount: new Money({
        amount: data.fee_amount,
        currency: data.currency,
        unit: data.unit,
      }),
      keysetId: data.keyset_id,
      keysetCounter: data.keyset_counter,
      outputAmounts: data.output_amounts,
      createdAt: data.created_at,
      version: data.version,
      transactionId: data.transaction_id,
    };

    const state = data.state as CashuTokenSwap['state'];

    if (state === 'FAILED') {
      return {
        ...commonData,
        state,
        failureReason: data.failure_reason ?? '',
      };
    }

    return {
      ...commonData,
      state,
    };
  }
}

export function useCashuTokenSwapRepository() {
  const encryption = useEncryption();
  const accountRepository = useAccountRepository();
  return new CashuTokenSwapRepository(agicashDb, encryption, accountRepository);
}
